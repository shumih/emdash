import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { toast } from 'sonner';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { ptyUploadProgressChannel } from '@shared/events/ptyEvents';
import type { FrontendPty, SessionTheme } from './pty';
import { resolveDroppedFile } from './terminal-image-injection';
import {
  buildTerminalImageInjection,
  clipboardDataMayContainImage,
  extractClipboardImageFiles,
} from './terminal-image-paths';
import { type PasteFromClipboardHandler, usePty } from './use-pty';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, scopeId, leafId)`.
   */
  sessionId: string;
  /** Pre-connected FrontendPty owned by the entity's PtySession store. */
  pty: FrontendPty;
  className?: string;
  contentFilter?: string;
  mapShiftEnterToCtrlJ?: boolean;
  /** SSH connection ID — used for remote file drag-and-drop and image paste. */
  remoteConnectionId?: string;
  themeOverride?: SessionTheme['override'];
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
};

type TerminalInputHelpers = Parameters<PasteFromClipboardHandler>[0];

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${Math.max(0, Math.trunc(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// A single Cmd+V on macOS can deliver two `paste` events — one from the Edit
// menu's role:'paste' accelerator and one from Chromium's native edit command —
// which would inject the same image twice. Dedupe by clipboard signature within
// a short window. 700ms catches the near-instant double-fire while still
// allowing a deliberate re-paste of the same image moments later.
const DUPLICATE_PASTE_WINDOW_MS = 700;

function clipboardSignature(clipboardData: DataTransfer | null, fallbackText: string): string {
  if (!clipboardData) return `text:${fallbackText.length}`;
  const files = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const file = item.getAsFile();
      return file ? `${file.name}:${file.size}:${file.lastModified}` : item.type;
    })
    .join('|');
  return `${clipboardData.types?.join(',') ?? ''}#${files}#${fallbackText.length}`;
}

async function injectTerminalImagePaths(args: {
  paths: string[];
  sessionId: string;
  remoteConnectionId: string | undefined;
  sendInput: TerminalInputHelpers['sendInput'];
  focus: TerminalInputHelpers['focus'];
}): Promise<void> {
  if (args.paths.length === 0) return;

  let paths = args.paths;
  if (args.remoteConnectionId) {
    // Stream live SFTP progress (file name + bytes transferred) into one toast,
    // scoped to this batch via uploadId, the way the Raycast uploader does.
    const uploadId = crypto.randomUUID();
    const toastId = `pty-upload-${uploadId}`;
    toast.loading('Uploading to remote…', { id: toastId });
    const unsubscribe = events.on(
      ptyUploadProgressChannel,
      (p) => {
        const label = p.count > 1 ? `${p.name} (${p.index}/${p.count})` : p.name;
        const size = p.total
          ? `${formatBytes(p.transferred)} / ${formatBytes(p.total)}`
          : 'sending…';
        toast.loading(`Uploading ${label} — ${size}`, { id: toastId });
      },
      uploadId
    );

    let result: Awaited<ReturnType<typeof rpc.pty.uploadFiles>>;
    try {
      result = await rpc.pty.uploadFiles({
        sessionId: args.sessionId,
        localPaths: paths,
        uploadId,
      });
    } finally {
      unsubscribe();
    }

    if (!result.success) {
      log.warn('SSH file transfer failed', { error: result.error });
      const description =
        'message' in result.error
          ? result.error.message
          : 'Could not upload image to the remote host.';
      toast.error('Image upload failed', { id: toastId, description });
      return;
    }
    paths = result.data.remotePaths;
    toast.success(
      paths.length > 1 ? `Uploaded ${paths.length} files to remote` : 'Uploaded to remote',
      { id: toastId }
    );
    if (paths.length === 0) return;
  }

  const platform = args.remoteConnectionId
    ? 'linux'
    : ((await rpc.app.getPlatform()) as NodeJS.Platform);
  const payload = buildTerminalImageInjection(paths, platform);
  void rpc.processHealth
    .record({
      kind: 'paste_inject_paths',
      sessionId: args.sessionId,
      remote: Boolean(args.remoteConnectionId),
      path_count: paths.length,
      payload_len: payload.length,
    })
    .catch(() => {});
  args.sendInput(`${payload} `, { track: false });
  args.focus();
}

async function pasteClipboardImageOrText(args: {
  sessionId: string;
  remoteConnectionId: string | undefined;
  sendInput: TerminalInputHelpers['sendInput'];
  focus: TerminalInputHelpers['focus'];
  fallbackText?: string;
  preferText?: boolean;
}): Promise<void> {
  if (args.preferText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        // Suspect path: a clipboard image often also carries a large text/HTML
        // (data-URL) representation; sending it verbatim floods the PTY/xterm.
        void rpc.processHealth
          .record({
            kind: 'paste_text',
            sessionId: args.sessionId,
            source: 'preferText',
            text_len: text.length,
          })
          .catch(() => {});
        args.sendInput(text);
        return;
      }
    } catch {
      // Clipboard text read denied or unavailable; try the image path below.
    }
  }

  try {
    const result = await rpc.pty.persistClipboardImage();
    if (result.success && result.data.path) {
      await injectTerminalImagePaths({ ...args, paths: [result.data.path] });
      return;
    }
  } catch (error) {
    log.warn('Terminal clipboard image paste failed', { error });
  }

  if (args.fallbackText !== undefined) {
    if (args.fallbackText) {
      void rpc.processHealth
        .record({
          kind: 'paste_text',
          sessionId: args.sessionId,
          source: 'fallbackText',
          text_len: args.fallbackText.length,
        })
        .catch(() => {});
      args.sendInput(args.fallbackText);
    }
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      void rpc.processHealth
        .record({
          kind: 'paste_text',
          sessionId: args.sessionId,
          source: 'readTextFallback',
          text_len: text.length,
        })
        .catch(() => {});
      args.sendInput(text);
    }
  } catch {
    // Clipboard read denied or unavailable.
  }
}

const PtyPaneComponent = forwardRef<{ focus: () => void }, Props>(
  (
    {
      sessionId,
      pty,
      className,
      contentFilter,
      mapShiftEnterToCtrlJ,
      remoteConnectionId,
      themeOverride,
      onActivity,
      onExit,
      onFirstMessage,
      onEnterPress,
      onInterruptPress,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const lastPasteRef = useRef<{ sig: string; at: number } | null>(null);

    const theme: SessionTheme = { override: themeOverride };

    const handleSystemPaste = useCallback<PasteFromClipboardHandler>(
      ({ focus, sendInput }) => {
        void pasteClipboardImageOrText({
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
          preferText: true,
        });
      },
      [remoteConnectionId, sessionId]
    );

    const { focus, sendInput } = usePty(
      {
        sessionId,
        pty,
        theme,
        mapShiftEnterToCtrlJ,
        onActivity,
        onExit,
        onFirstMessage,
        onEnterPress,
        onInterruptPress,
        onPasteFromClipboard: handleSystemPaste,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const injectImagePaths = useCallback(
      async (paths: string[]) => {
        await injectTerminalImagePaths({
          paths,
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
        });
      },
      [focus, remoteConnectionId, sendInput, sessionId]
    );

    const injectImageFiles = useCallback(
      async (files: File[]): Promise<boolean> => {
        const resolved = await Promise.all(files.map((file) => resolveDroppedFile(file)));
        const paths = resolved.filter((path): path is string => Boolean(path));
        if (paths.length === 0) return false;
        await injectImagePaths(paths);
        return true;
      },
      [injectImagePaths]
    );

    const handleFocus = () => {
      focus();
    };

    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        const clipboardData = event.clipboardData;
        const fallbackText = clipboardData?.getData('text/plain') ?? '';

        // When we handle the paste ourselves, also stop propagation so the event
        // never reaches xterm's own textarea paste listener — otherwise xterm
        // pastes the clipboard's text (e.g. the source image's file path) and a
        // second image is injected alongside ours.
        const claimPaste = () => {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
        };

        // Drop a duplicate paste event for the same clipboard content (macOS
        // double-fires Cmd+V), so an image isn't injected twice.
        const sig = clipboardSignature(clipboardData, fallbackText);
        const now = Date.now();
        const last = lastPasteRef.current;
        if (last && last.sig === sig && now - last.at < DUPLICATE_PASTE_WINDOW_MS) {
          claimPaste();
          lastPasteRef.current = { sig, at: now };
          return;
        }
        lastPasteRef.current = { sig, at: now };

        const imageFiles = extractClipboardImageFiles(clipboardData);
        if (imageFiles.length > 0) {
          claimPaste();
          void rpc.processHealth
            .record({
              kind: 'paste_image_files',
              sessionId,
              file_count: imageFiles.length,
              total_bytes: imageFiles.reduce((n, f) => n + f.size, 0),
              types: clipboardData?.types?.join(',') ?? '',
              fallback_text_len: fallbackText.length,
            })
            .catch(() => {});
          void (async () => {
            try {
              const injected = await injectImageFiles(imageFiles);
              if (injected) return;
              await pasteClipboardImageOrText({
                sessionId,
                remoteConnectionId,
                focus,
                sendInput,
                fallbackText,
              });
            } catch (error) {
              log.warn('Terminal image paste failed', { error });
              toast.error('Could not attach image');
            }
          })();
          return;
        }

        // A "copy image" from Chrome (and many native apps) lands on the OS
        // clipboard as raw image data, NOT a file item, and the DOM paste event
        // often exposes no `image/*` type for it. In that case the checks above
        // miss it. So: bail only when there is plain text to paste (a genuine
        // text paste — leave it to xterm's native bracketed paste); otherwise
        // treat an empty/imagey paste as a possible image and let the main
        // process read it via the Electron clipboard (clipboard.readImage).
        const mayContainImage = clipboardDataMayContainImage(clipboardData);
        if (!mayContainImage && fallbackText) return;

        void rpc.processHealth
          .record({
            kind: 'paste_image_probe',
            sessionId,
            may_contain_image: mayContainImage,
            types: clipboardData?.types?.join(',') ?? '',
            fallback_text_len: fallbackText.length,
          })
          .catch(() => {});

        claimPaste();
        void pasteClipboardImageOrText({
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
          fallbackText,
        });
      },
      [focus, injectImageFiles, remoteConnectionId, sendInput, sessionId]
    );

    const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const files = Array.from(dt.files);

        void (async () => {
          try {
            const resolved = await Promise.all(files.map((file) => resolveDroppedFile(file)));
            const paths = resolved.filter((path): path is string => Boolean(path));
            if (paths.length === 0) return;
            await injectImagePaths(paths);
          } catch (error) {
            log.warn('Terminal drop failed', { error });
            toast.error('Could not attach dropped file');
          }
        })();
      } catch (error) {
        log.warn('Terminal drop failed', { error });
      }
    };

    return (
      <div
        className={cn('terminal-pane flex h-full w-full min-w-0 bg', className)}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          backgroundColor: themeOverride?.background ?? 'var(--background-secondary)',
        }}
      >
        <div
          ref={containerRef}
          data-terminal-container
          className={cn('p-2 ', themeOverride?.background ? '' : 'bg-background-secondary-1')}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            filter: contentFilter || undefined,
          }}
          onClick={handleFocus}
          onMouseDown={handleFocus}
          onPasteCapture={handlePaste}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        />
      </div>
    );
  }
);

PtyPaneComponent.displayName = 'TerminalPane';

export const PtyPane = React.memo(PtyPaneComponent);
