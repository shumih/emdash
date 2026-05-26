import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import { useDiffEditorComments } from '@renderer/features/tasks/diff-view/comments/use-diff-editor-comments';
import { ImageDiffView } from '@renderer/features/tasks/diff-view/main-panel/image-diff-view';
import { isMissingFileError } from '@renderer/features/tasks/diff-view/main-panel/missing-file-error';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import { gitRefToString, HEAD_REF, STAGED_REF, type GitObjectRef } from '@shared/git';
import { getDraftCommentTargetKey, type DraftCommentTarget } from '@shared/lineComments';
import type { ActiveFile } from '@shared/view-state';

interface DiffFileRendererProps {
  tab: DiffTabStore;
}

// Monaco's diff editor renders the full content of both sides, so total model line
// count — not just changed lines — drives memory use. Past this many lines a single
// diff can blow up the renderer heap (GC thrash → frozen UI), so we gate it behind a
// confirm, mirroring the stacked diff view's large-diff guard.
const LARGE_DIFF_LINE_THRESHOLD = 20000;

/**
 * Routes a diff tab to the correct renderer based on its renderer kind.
 * Mirrors the FileRenderer pattern for file tabs.
 */
export const DiffFileRenderer = observer(function DiffFileRenderer({ tab }: DiffFileRendererProps) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();

  switch (tab.renderer.kind) {
    case 'text':
      return <MonacoDiffRenderer tab={tab} />;
    case 'image': {
      const activeFile = tabToActiveFile(tab);
      return (
        <ImageDiffView
          key={`${workspaceId}:${tab.diffGroup}:${tab.path}`}
          projectId={projectId}
          workspaceId={workspaceId}
          activeFile={activeFile}
        />
      );
    }
    case 'binary':
      return (
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          Binary file — no diff available
        </div>
      );
  }
});

/**
 * Renders a text diff using the Monaco diff editor.
 * Owns model registration, URI computation, and draft comment wiring.
 */
const MonacoDiffRenderer = observer(function MonacoDiffRenderer({ tab }: DiffFileRendererProps) {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const diffView = useWorkspaceViewModel().diffView;
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;

  const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [forceLoad, setForceLoad] = useState(false);

  const commentTarget = diffTabToCommentTarget(tab);
  const commentTargetKey = getDraftCommentTargetKey(commentTarget);
  const comments = draftComments?.getCommentsForTarget(commentTargetKey) ?? [];

  const handleAddComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!draftComments) return;
      draftComments.addComment({
        target: commentTarget,
        lineNumber,
        lineContent: lineContent ?? null,
        content,
      });
    },
    [commentTarget, draftComments]
  );

  const handleEditComment = useCallback(
    (id: string, content: string) => {
      draftComments?.updateComment(id, content);
    },
    [draftComments]
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      draftComments?.deleteComment(id);
    },
    [draftComments]
  );

  useDiffEditorComments({
    editor,
    comments,
    onAddComment: handleAddComment,
    onEditComment: handleEditComment,
    onDeleteComment: handleDeleteComment,
  });

  const root = `workspace:${workspaceId}`;
  const uri = buildMonacoModelPath(root, tab.path);
  const language = getLanguageFromPath(tab.path);

  const originalUri = (() => {
    if (tab.diffGroup === 'disk') {
      return modelRegistry.toGitUri(uri, STAGED_REF);
    }
    if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') {
      return modelRegistry.toGitUri(uri, tab.originalRef);
    }
    return modelRegistry.toGitUri(uri, HEAD_REF);
  })();

  const modifiedUri = (() => {
    if (tab.diffGroup === 'staged') return modelRegistry.toGitUri(uri, STAGED_REF);
    if (tab.diffGroup === 'pr') {
      return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    }
    if (tab.diffGroup === 'git') {
      return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    }
    return uri;
  })();

  useEffect(() => {
    let disposed = false;

    if (tab.diffGroup === 'disk') {
      const diskUri = modelRegistry.toDiskUri(uri);
      void (async () => {
        if (tab.status !== 'deleted') {
          try {
            await modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              tab.path,
              language,
              'disk'
            );
          } catch (err) {
            if (!isMissingFileError(err)) throw err;
          }
        }
        if (disposed) {
          modelRegistry.unregisterModel(diskUri);
          return;
        }
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          tab.path,
          language,
          'buffer'
        );
        if (disposed) {
          modelRegistry.unregisterModel(modifiedUri);
        }
      })().catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else if (tab.diffGroup === 'staged') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', HEAD_REF)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', tab.originalRef)
        .catch(() => {});
      const effectiveModifiedRef = tab.modifiedRef ?? HEAD_REF;
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          tab.path,
          language,
          'git',
          effectiveModifiedRef
        )
        .catch(() => {});
    }

    return () => {
      disposed = true;
      modelRegistry.unregisterModel(originalUri);
      modelRegistry.unregisterModel(modifiedUri);
      if (tab.diffGroup === 'disk') {
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      }
    };
  }, [
    originalUri,
    modifiedUri,
    language,
    tab.path,
    tab.diffGroup,
    tab.originalRef,
    tab.modifiedRef,
    tab.status,
    projectId,
    workspaceId,
    root,
    uri,
  ]);

  // Re-arm the large-diff guard whenever the file (URIs) changes.
  useEffect(() => {
    setForceLoad(false);
  }, [originalUri, modifiedUri]);

  // Read model readiness + size reactively (observer): only mount the heavy diff
  // editor once both models are ready, and only if the diff is not pathologically
  // large (or the user explicitly opted in via "Load anyway").
  const originalStatus = modelRegistry.modelStatus.get(originalUri);
  const modifiedStatus = modelRegistry.modelStatus.get(modifiedUri);
  const modelsReady = originalStatus === 'ready' && modifiedStatus === 'ready';
  const maxModelLines = modelsReady
    ? Math.max(
        modelRegistry.getModelByUri(originalUri)?.getLineCount() ?? 0,
        modelRegistry.getModelByUri(modifiedUri)?.getLineCount() ?? 0
      )
    : 0;
  const isLargeDiff = maxModelLines > LARGE_DIFF_LINE_THRESHOLD;

  if (!diffView) return null;

  return (
    <div className="file-diff-view flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {modelsReady && isLargeDiff && !forceLoad ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-foreground-passive">
            <span>
              Large diff ({maxModelLines.toLocaleString()} lines). Loading may freeze the UI.
            </span>
            <button
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-background-1"
              onClick={() => setForceLoad(true)}
            >
              Load anyway
            </button>
          </div>
        ) : modelsReady ? (
          <StickyDiffEditor
            originalUri={originalUri}
            modifiedUri={modifiedUri}
            diffStyle={diffView.diffStyle}
            onEditorChange={setEditor}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-foreground-passive">
            Loading diff…
          </div>
        )}
      </div>
    </div>
  );
});

function refShaOrString(ref: GitObjectRef | undefined): string {
  if (!ref) return gitRefToString(HEAD_REF);
  return ref.kind === 'commit' ? ref.sha : gitRefToString(ref);
}

function diffTabToCommentTarget(tab: DiffTabStore): DraftCommentTarget {
  if (tab.diffGroup === 'disk' || tab.diffGroup === 'staged') {
    return { kind: 'working-tree', group: tab.diffGroup, path: tab.path };
  }

  if (tab.diffGroup === 'pr') {
    return {
      kind: 'pr',
      prNumber: tab.prNumber ?? 0,
      baseOid: tab.prBaseOid ?? refShaOrString(tab.originalRef),
      headOid: tab.prHeadOid ?? refShaOrString(tab.modifiedRef),
      path: tab.path,
    };
  }

  return {
    kind: 'commit',
    originalSha:
      tab.commitOriginalSha !== undefined ? tab.commitOriginalSha : refShaOrString(tab.originalRef),
    modifiedSha: tab.commitModifiedSha ?? refShaOrString(tab.modifiedRef),
    path: tab.path,
  };
}

function tabToActiveFile(tab: DiffTabStore): ActiveFile {
  return {
    path: tab.path,
    type: tab.diffGroup === 'disk' ? 'disk' : 'git',
    group: tab.diffGroup,
    originalRef: tab.originalRef,
    modifiedRef: tab.modifiedRef,
    prNumber: tab.prNumber,
    prBaseOid: tab.prBaseOid,
    prHeadOid: tab.prHeadOid,
    commitOriginalSha: tab.commitOriginalSha,
    commitModifiedSha: tab.commitModifiedSha,
  };
}
