import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { RawgSearch } from "@/components/admin/RawgSearch";
import { ui } from "@/components/admin/ui";
import { candidatesFor, checkTitle, RAWG_FIX_PATH } from "@/core/rawgAdmin";
import { isRawgConfigured } from "@/core/services/rawg";
import { fixFor, listFixes, rawgImageUrl, readToCheck, type Doubtful, type Fix } from "@/core/services/rawgFixes";
import { titleKey } from "@/core/services/rawgMatch";
import { chooseGameAction, chooseImageAction, chooseNoneAction, confirmAction, forgetAction, forgetAllAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";
const SAVED = new Set(["game", "none", "image", "confirm", "forgot"]);

/** Une jaquette : image fixe, sans défilement, avec un texte vide (le nom du jeu est juste à côté). */
function Cover({ url, size = "h-24 w-[4.5rem]" }: { url: string | null; size?: string }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" width={72} height={96} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`${size} shrink-0 rounded-lg border border-line bg-bg object-cover`} />
    : <div aria-hidden="true" className={`${size} shrink-0 rounded-lg border border-dashed border-line bg-bg`} />;
}

export default async function RawgCoversPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t, advanced, locale, user } = await adminCtx("admin");
  const sp = await searchParams;
  const configured = await isRawgConfigured();
  const saved = SAVED.has(one(sp.saved)) ? one(sp.saved) : "";
  const asked = one(sp.titre);
  const title = asked ? checkTitle(asked) : null;
  const q = one(sp.q).slice(0, 400);
  const qTooLong = q.trim().length > 100;
  const page = Number(one(sp.page)) || 1;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin/settings#services" className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">← {t("rawgfix.back")}</Link>
        <h1 className={ui.pageTitle}>{title ? t("rawgfix.which") : t("rawgfix.title")}</h1>
        <p className={ui.pageIntro}>{title ? t("rawgfix.whichIntro") : t("rawgfix.intro")}</p>
      </header>

      {saved && <p role="status" className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{t(`rawgfix.saved.${saved}`)}</p>}
      {asked && !title && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{t("rawgfix.err.title")}</p>}
      {!configured && (
        <div role="alert" className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800">
          <p>{t("rawgfix.noKey")}</p>
          <Link href="/admin/settings#services" className={`${ui.btn} min-h-11`}>{t("rawgfix.noKeyLink")}</Link>
        </div>
      )}

      {title ? <FixScreen title={title} q={qTooLong ? "" : q} qTooLong={qTooLong} userId={user.id} advanced={advanced} configured={configured} t={t} /> : <ListScreen page={page} configured={configured} t={t} date={date} />}
    </div>
  );
}

type T = Awaited<ReturnType<typeof adminCtx>>["t"];

// ── La liste « Jaquettes à vérifier » et les corrections gardées ─────────────────────────────────────────────────────────────
async function ListScreen({ page, t, date }: { page: number; configured: boolean; t: T; date: (iso: string) => string }) {
  const todo = await readToCheck();
  const kept = await listFixes(page);
  const href = (p: number) => `${RAWG_FIX_PATH}${p > 1 ? `?page=${p}` : ""}`;
  return (
    <>
      <section className="space-y-3" data-testid="rawg-todo" aria-labelledby="rawg-todo-h">
        <h2 id="rawg-todo-h" className="text-lg font-semibold">{t("rawgfix.todoTitle")}</h2>
        {todo.length === 0 ? (
          <p className={`${ui.card} text-sm`} data-testid="rawg-empty">{t("rawgfix.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {todo.map((d) => <Todo key={d.key} d={d} t={t} date={date} />)}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-testid="rawg-kept" aria-labelledby="rawg-kept-h">
        <div>
          <h2 id="rawg-kept-h" className="text-lg font-semibold">{t("rawgfix.keptTitle")}</h2>
          <p className={ui.help}>{t("rawgfix.keptHelp")}</p>
        </div>
        {kept.total === 0 ? (
          <p className={`${ui.card} text-sm`}>{t("rawgfix.keptEmpty")}</p>
        ) : (
          <>
            <ul className="space-y-3">
              {kept.items.map((f) => <Kept key={f.key} f={f} k={f.key} t={t} date={date} />)}
            </ul>
            {kept.pages > 1 && (
              <nav aria-label={t("rawgfix.pages")} className="flex flex-wrap items-center gap-3">
                {kept.page > 1 ? <Link href={href(kept.page - 1)} className={`${ui.btn} min-h-11`}>{t("rawgfix.prev")}</Link> : <span />}
                <span className="text-sm text-muted">{t("rawgfix.pageOf", { page: kept.page, pages: kept.pages })}</span>
                {kept.page < kept.pages ? <Link href={href(kept.page + 1)} className={`${ui.btn} min-h-11`}>{t("rawgfix.next")}</Link> : null}
              </nav>
            )}
            <ActionForm action={forgetAllAction} submitLabel={t("rawgfix.forgetAll")} pendingLabel={t("progress.deleting")} confirm={t("rawgfix.forgetAllConfirm", { count: kept.total })} secondary className="space-y-2">{null}</ActionForm>
          </>
        )}
      </section>
    </>
  );
}

function Todo({ d, t, date }: { d: Doubtful; t: T; date: (iso: string) => string }) {
  const fixHref = `${RAWG_FIX_PATH}?titre=${encodeURIComponent(d.title)}`;
  return (
    <li className={`${ui.card} flex flex-col gap-4 sm:flex-row sm:items-center`} data-testid="rawg-todo-item">
      <div className="flex min-w-0 flex-1 gap-4">
        <Cover url={rawgImageUrl(d.img)} />
        <div className="min-w-0 space-y-1">
          <p className="break-words font-semibold">{d.title}</p>
          <p className="break-words text-sm">{t("rawgfix.foundGame", { name: d.name })}</p>
          <p className="text-[13px] text-muted">{t("rawgfix.possible", { count: d.candidates })} · {t("rawgfix.seen", { date: date(d.at) })}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:w-48 sm:shrink-0">
        <Link href={fixHref} className={`${ui.btnPrimary} min-h-11`}>{t("rawgfix.fix")}</Link>
        <ActionForm action={confirmAction} submitLabel={t("rawgfix.good")} pendingLabel={t("progress.saving")} secondary className="space-y-2">
          <input type="hidden" name="title" value={d.title} />
        </ActionForm>
      </div>
    </li>
  );
}

function Kept({ f, k, t, date }: { f: Fix; k: string; t: T; date: (iso: string) => string }) {
  const what = f.kind === "none" ? t("rawgfix.keptNone") : f.kind === "image" ? t("rawgfix.keptImage") : f.name || t("rawgfix.keptGame");
  return (
    <li className={`${ui.card} flex flex-col gap-4 sm:flex-row sm:items-center`} data-testid="rawg-kept-item">
      <div className="flex min-w-0 flex-1 gap-4">
        <Cover url={f.img ? rawgImageUrl(f.img) : null} size="h-16 w-12" />
        <div className="min-w-0 space-y-1">
          <p className="break-words font-semibold">{f.title}</p>
          <p className="break-words text-sm">{what}</p>
          <p className="text-[13px] text-muted">{t("rawgfix.keptOn", { date: date(f.at) })}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:w-40 sm:shrink-0">
        <Link href={`${RAWG_FIX_PATH}?titre=${encodeURIComponent(f.title)}`} className={`${ui.btn} min-h-11`}>{t("rawgfix.change")}</Link>
        <ActionForm action={forgetAction} submitLabel={t("rawgfix.forget")} pendingLabel={t("progress.deleting")} secondary className="space-y-2">
          <input type="hidden" name="key" value={k} />
        </ActionForm>
      </div>
    </li>
  );
}

// ── « Quel est le bon jeu ? » ────────────────────────────────────────────────────────────────────────────────────────────────────
async function FixScreen({ title, q, qTooLong, userId, advanced, configured, t }: { title: string; q: string; qTooLong: boolean; userId: string; advanced: boolean; configured: boolean; t: T }) {
  const key = titleKey(title);
  const saved = await fixFor(title);
  const doubtful = (await readToCheck()).find((d) => d.key === key);
  const list = configured && !qTooLong ? await candidatesFor(`admin:${userId}`, title, q.trim() || undefined) : null;
  const current = saved
    ? { url: saved.img ? rawgImageUrl(saved.img) : null, label: saved.kind === "none" ? t("rawgfix.keptNone") : saved.kind === "image" ? t("rawgfix.keptImage") : saved.name || t("rawgfix.keptGame"), id: saved.rawgId }
    : doubtful ? { url: rawgImageUrl(doubtful.img), label: doubtful.name, id: doubtful.rawgId } : null;
  const message = list ? t(`rawgfix.status.${list.status}`) : "";

  return (
    <div className="space-y-6">
      <section className={`${ui.card} space-y-3`}>
        <p className="break-words text-sm text-muted">{t("rawgfix.asked")}</p>
        <p className="break-words text-xl font-semibold" data-testid="rawg-asked">{title}</p>
        {current && (
          <div className="flex items-center gap-3" data-testid="rawg-current">
            <Cover url={current.url} size="h-16 w-12" />
            <p className="min-w-0 break-words text-sm"><span className="text-muted">{saved ? t("rawgfix.currentSaved") : t("rawgfix.currentAuto")}</span><br />{current.label}</p>
          </div>
        )}
        {!saved && doubtful && (
          <ActionForm action={confirmAction} submitLabel={t("rawgfix.good")} pendingLabel={t("progress.saving")} secondary className="space-y-2">
            <input type="hidden" name="title" value={title} />
          </ActionForm>
        )}
      </section>

      <section className={`${ui.card} space-y-3`}>
        <RawgSearch path={RAWG_FIX_PATH} title={title} initial={q} error={qTooLong ? t("rawgfix.err.search") : undefined}
          labels={{ label: t("rawgfix.searchLabel"), help: t("rawgfix.searchHelp"), button: t("rawgfix.searchButton"), pending: t("rawgfix.searching") }} />
      </section>

      <section className="space-y-3" aria-labelledby="rawg-cands-h">
        <h2 id="rawg-cands-h" className="text-lg font-semibold">{t("rawgfix.candidates")}</h2>
        {message && list?.status !== "found" && <p role="status" className={`${ui.card} text-sm`} data-testid="rawg-status">{message}</p>}
        {list?.status === "found" && (
          <ul className="space-y-3" data-testid="rawg-candidates">
            {list.candidates.map((c) => (
              <li key={c.id} className={`${ui.card} flex flex-col gap-4 sm:flex-row sm:items-center`} data-testid="rawg-candidate">
                <div className="flex min-w-0 flex-1 gap-4">
                  <Cover url={c.url} />
                  <div className="min-w-0 space-y-1">
                    <p className="break-words font-semibold">{c.name}</p>
                    <p className="text-sm text-muted">{c.year ? t("rawgfix.year", { year: c.year }) : t("rawgfix.yearUnknown")}</p>
                    <p className="break-words text-sm text-muted">{c.platforms.length ? t("rawgfix.platforms", { list: c.platforms.join(", ") }) : t("rawgfix.platformsUnknown")}</p>
                    {current?.id === c.id && <p><span className={ui.chipOk}>{t("rawgfix.isCurrent")}</span></p>}
                  </div>
                </div>
                <div className="sm:w-44 sm:shrink-0">
                  <ActionForm action={chooseGameAction} submitLabel={t("rawgfix.choose")} pendingLabel={t("progress.saving")} className="space-y-2">
                    <input type="hidden" name="title" value={title} />
                    <input type="hidden" name="rawgId" value={c.id} />
                    <input type="hidden" name="q" value={q.trim()} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${ui.card} space-y-3`}>
        <h2 className="text-lg font-semibold">{t("rawgfix.noneTitle")}</h2>
        <p className={ui.help}>{t("rawgfix.noneHelp")}</p>
        <ActionForm action={chooseNoneAction} submitLabel={t("rawgfix.none")} pendingLabel={t("progress.saving")} secondary className="space-y-2">
          <input type="hidden" name="title" value={title} />
        </ActionForm>
      </section>

      {advanced && (
        <section className={`${ui.card} space-y-3`}>
          <h2 className="text-lg font-semibold">{t("rawgfix.imageTitle")}</h2>
          <ActionForm action={chooseImageAction} submitLabel={t("rawgfix.imageButton")} pendingLabel={t("progress.saving")} className="space-y-3">
            <input type="hidden" name="title" value={title} />
            <TextField name="imageUrl" type="url" label={t("rawgfix.imageField")} help={t("rawgfix.imageHelp")} placeholder="https://media.rawg.io/media/games/…" autoComplete="off" />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
