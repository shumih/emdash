# FORK.md — Tondash

Это форк **[emdash](https://github.com/generalaction/emdash)** (upstream: `generalaction/emdash`).
Мы продолжаем подтягивать изменения из upstream (мержи и отдельные коммиты), поэтому
этот файл — памятка по тому, **что в форке наше** и **как разрешать конфликты при мерже**.

> Этот файл — наш (Tondash). При мерже из upstream он конфликтовать не должен (его там нет),
> но если появится — оставляем нашу версию.

## Что это за проект

- **Tondash** = ребрендинг emdash. Кодовая база общая, мы хотим получать апстримные
  фичи и фиксы.
- Мы **не уходим в hard-fork**: периодически мержим upstream в наши ветки.
- Пока что наши изменения = **ребрендинг** + точечные **фиксы** (SSH, userData, утечка памяти).
  Своих фич и продуктовых изменений логики пока нет — когда появятся, добавляем их в раздел
  «Наши фичи / изменения логики» ниже.

## Remotes и процесс мержа

```bash
# origin   = наш форк
git remote -v
#   origin    https://github.com/shumih/emdash.git
#   upstream  https://github.com/generalaction/emdash.git

# Подтянуть upstream
git fetch upstream
git merge upstream/main        # или cherry-pick отдельных коммитов
```

После мержа **обязательно** прогнать (см. `AGENTS.md`):
`pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test`,
и проверить, что приложение всё ещё называется **Tondash**, а не emdash.

## Что остаётся НАШИМ при merge-конфликтах

### 1. Брендинг (всегда оставляем Tondash)

При конфликте по строкам/идентичности приложения — **наша версия (Tondash)**.
Файлы, которые мы переименовали и где правда нашей стороны:

- `src/shared/app-identity.ts`, `src/shared/app-identity.canary.ts` — productName, appId, dataDir.
- `package.json` — `name`, `productName`.
- `electron-builder.config.ts` (и `.canary.config.ts`, если правим) — appId, productName, иконки.
- `src/renderer/index.html` — `<title>`.
- `src/main/index.ts` — userData dir (своя папка, не `emdash`).
- `src/renderer/app/app-menu-events.tsx`, `src/renderer/features/settings/components/AccountTab.tsx` — пользовательские строки.
- `src/assets/images/tondash/` — иконки (`app-icon.png`, `icon-dock.png`, `tondash.icns`).

⚠️ В репозитории всё ещё **много упоминаний `emdash`** (env-переменные `EMDASH_*`, имена
сервисов аккаунта, доки в `agents/`, CI-воркфлоу). Мы их **намеренно НЕ трогали** — это
внутренние идентификаторы, ребрендить которые рискованно (БД, обновления, аккаунт-сервис).
Не путать с пользовательским брендингом: env-ключи и внутренние имена при мерже
**оставляем как в upstream**, чтобы не ломать совместимость.

### 2. Наши фиксы (оставляем нашу логику, но переносим апстримные правки рядом)

Это места, где мы **поменяли логику**, потому что апстримная нас не устраивала.
При конфликте — сохраняем наш фикс, аккуратно накатывая сверху апстримные изменения.

- **SSH-аутентификация** — `src/main/core/ssh/connect/ssh-connect-auth.ts`
  (+ `resolve-ssh-connect-config.test.ts`). Мы добавили `IdentitiesOnly` + явный `IdentityFile`.
- **Своя userData-папка** — `src/main/index.ts` / `src/shared/app-identity.ts`.
  Раньше путь был захардкожен как `emdash`.
- **Утечка памяти renderer'а** — `src/renderer/features/tasks/conversations/conversation-manager.ts`,
  `src/renderer/features/tasks/tabs/tab-manager-store.ts`. Освобождаем xterm чата при закрытии вкладки.

### 3. Наши фичи / изменения логики

_Пока пусто._ Сюда добавляем будущие задачи/фичи: что сделали, какие файлы, почему.

## Как читать наши коммиты (приоритеты при мерже)

Все наши коммиты — от автора **Anton Shumikhin** поверх последнего апстрим-мержа.
Быстро посмотреть, что наше:

```bash
git log --author="Anton Shumikhin" --oneline
# или относительно точки расхождения с upstream:
git log upstream/main..HEAD --no-merges --format='%h %an  %s'
```

Категории по префиксу/смыслу сообщения (определяют, насколько бережно разрешать конфликт):

| Тип | Что значит | При конфликте |
| --- | --- | --- |
| `Rebrand …` | косметика/идентичность | оставляем Tondash |
| `Fix: …` / `Fix …` | мы чинили баг, которого нет/иначе в upstream | сохраняем наш фикс, проверяем не пофикшено ли уже сверху |
| (будущее) фичи | новая продуктовая логика | сохраняем, мержим вручную |

Текущие наши коммиты:

- `Rebrand Emdash → Tondash (product name, appId, data dir)` — ребрендинг.
- `Rebrand app icon to Tondash` — ребрендинг.
- `Fix: give Tondash its own userData dir (was hardcoded to 'emdash')` — фикс.
- `Fix SSH agent auth with IdentitiesOnly + IdentityFile` — фикс.
- `Fix renderer memory leak: free chat xterm on tab close` — фикс.

> Держите этот список в актуальном состоянии: каждый новый «наш» коммит, меняющий брендинг,
> фиксящий баг или добавляющий логику, дописывайте в соответствующий раздел.
