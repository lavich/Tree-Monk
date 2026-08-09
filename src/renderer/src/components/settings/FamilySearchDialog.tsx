import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  LogIn,
  Download,
  Loader2,
  CheckCircle2,
  Info,
  AlertTriangle,
  ArrowUp,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FsSolutionBadge,
  FsTrademarkNotice,
  FsWorksWithHeader,
} from "@/components/common/FsBrand";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useAppStore } from "@/store/useAppStore";
import { setFsMode } from "@/lib/fsMode";
import {
  DEFAULT_ASCEND,
  DEFAULT_COLLATERAL,
  DEFAULT_DESCEND,
  DEFAULT_IMPORT_PERSONS,
  MAX_ASCEND,
  MAX_COLLATERAL,
  MAX_DESCEND,
  MAX_IMPORT_PERSONS,
} from "@shared/familysearch";
import { cn } from "@/lib/utils";

/** Persons per second used for the time hint. Deliberately the CONSERVATIVE
 *  figure from the old fixed pacing: the scheduler now speeds itself up while
 *  the server allows it, so a real import tends to beat this estimate rather
 *  than miss it — and over-promising speed is the worse failure. */
const PERSONS_PER_SECOND = 2.5;

/**
 * Order-of-magnitude estimate of how many people a setting will pull in. It is
 * deliberately rough — real trees are uneven — but it is enough to tell "a few
 * dozen" apart from "far past the limit", which is the decision the user needs.
 */
function estimatePeople(
  ascend: number,
  descend: number,
  collateral: number,
): number {
  // 2 parents per generation is the theoretical maximum; real lines dead-end
  // and repeat, so 1.5 tracks actual FamilySearch data far better.
  let ancestors = 0;
  for (let g = 1; g <= ascend; g++) ancestors += Math.pow(1.5, g);
  // THE dangerous multiplier: each side-branch level roughly triples what every
  // ancestor drags along (siblings → their children → cousins…).
  const sideFactor = Math.pow(3.2, collateral);
  let descendants = 0;
  for (let g = 1; g <= descend; g++) descendants += Math.pow(2.2, g);
  return Math.round(1 + ancestors * sideFactor + descendants);
}

/**
 * One scope control: a labelled slider with a live value pill and a one-line
 * explanation. Sliders beat number boxes here — the range itself communicates
 * what is normal, and you cannot type 100 into one by accident.
 */
function ScopeSlider({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  disabled,
  badge,
  danger,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  badge?: { text: string; tone: "good" | "warn" } | null;
  danger?: boolean;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{label}</p>
        {badge && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              badge.tone === "good"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            {badge.text}
          </span>
        )}
        <span
          className={cn(
            "ml-auto min-w-10 rounded-lg px-2 py-0.5 text-center text-sm font-semibold tabular-nums",
            danger
              ? "bg-red-500/15 text-red-700 dark:text-red-400"
              : "bg-primary/15 text-primary",
          )}
        >
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border disabled:cursor-not-allowed disabled:opacity-50",
          danger ? "accent-red-500" : "accent-primary",
        )}
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * FamilySearch hub: sign in on FamilySearch's own page (system browser, no
 * password handling), then import your tree from the official API. Contribution
 * (write-back) lives on each person's profile.
 */
export function FamilySearchDialog({
  open,
  onOpenChange,
  mandatory = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Start-flow (new tree / wipe): the dialog CANNOT be dismissed to an empty
   *  dashboard — the user must import, or explicitly switch to Manual mode. */
  mandatory?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const refreshAll = useAppStore((s) => s.refreshAll);
  const startFsImport = useAppStore((s) => s.startFsImport);
  const setView = useAppStore((s) => s.setView);
  const [configured, setConfigured] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState<"signin" | "import" | null>(null);
  // One extra stop before the import starts: what loads WHEN (photos and
  // sources only at the very end), so nobody reports the interim state as a bug.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const [ascend, setAscend] = useState(DEFAULT_ASCEND);
  const [descend, setDescend] = useState(DEFAULT_DESCEND);
  const [collateral, setCollateral] = useState(DEFAULT_COLLATERAL);
  const [maxPersons, setMaxPersons] = useState(DEFAULT_IMPORT_PERSONS);
  const [trees, setTrees] = useState<
    { id: string; name: string; kind: "global" | "user" }[]
  >([]);
  const [treeId, setTreeId] = useState("GLOBAL");
  const [rootFid, setRootFid] = useState("");
  const [rootCheck, setRootCheck] = useState<{
    status: "idle" | "checking" | "found" | "notfound";
    name?: string;
    lifespan?: string;
  }>({ status: "idle" });
  const bailed = useRef(false);

  // Deliberate escape hatch: leave the mandatory FS flow for a usable Manual
  // tree (never trap the user on an empty dashboard).
  // Verify the entered starting person id (debounced) so the user can confirm
  // exactly who the import will start from.
  useEffect(() => {
    const id = rootFid.trim();
    if (!id) {
      setRootCheck({ status: "idle" });
      return;
    }
    setRootCheck({ status: "checking" });
    const h = setTimeout(() => {
      void window.api.familysearch.lookupPerson(id, treeId).then((r) => {
        setRootCheck(
          r.found
            ? { status: "found", name: r.name, lifespan: r.lifespan }
            : { status: "notfound" },
        );
      });
    }, 500);
    return () => clearTimeout(h);
  }, [rootFid, treeId]);

  const switchToManual = (): void => {
    setFsMode(false);
    bailed.current = true;
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;
    void window.api.familysearch.configured().then(setConfigured);
    void window.api.familysearch.signedIn().then((si) => {
      setSignedIn(si);
      if (si) void window.api.familysearch.listTrees().then(setTrees);
    });
  }, [open]);

  const signIn = async (): Promise<void> => {
    setBusy("signin");
    try {
      const r = await window.api.familysearch.login(i18n.language);
      if (r.ok) {
        setSignedIn(true);
        setFsMode(true);
        // Now that we're signed in, load the user's trees for the selector.
        void window.api.familysearch.listTrees().then(setTrees);
        window.dispatchEvent(new Event("fs-auth-changed"));
        toast.success(t("fs.signedIn"));
      } else if (r.error === "NO_CLIENT_ID") toast.error(t("fs.noClientId"));
      else if (r.error !== "CANCELLED") toast.error(t("fs.loginFailed"));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async (): Promise<void> => {
    await window.api.familysearch.signOut();
    setSignedIn(false);
    window.dispatchEvent(new Event("fs-auth-changed"));
  };

  // Connection self-test against FamilySearch's own /platform/throttled
  // endpoint (it answers 429 deliberately): proves the client waits out
  // Retry-After and recovers, and reports where the pacing loop settled.
  const runThrottleProbe = async (): Promise<void> => {
    setProbing(true);
    try {
      const r = await window.api.familysearch.throttleProbe();
      if (r.ok) {
        toast.success(
          t("fs.probeOk", {
            seconds: (r.waitedMs / 1000).toFixed(1),
            attempts: r.attempts,
            concurrency: r.pace.concurrency,
            spacing: r.pace.spacingMs,
          }),
        );
      } else {
        toast.error(t("fs.probeFail", { status: r.status }));
      }
    } catch {
      toast.error(t("fs.probeFail", { status: 0 }));
    } finally {
      setProbing(false);
    }
  };

  // Live feedback for the scope fields: how big this import is likely to get,
  // how long that takes, and whether the safety cap will cut it short.
  const rawEstimate = estimatePeople(ascend, descend, collateral);
  const overCap = rawEstimate > maxPersons;
  const estimateShown = Math.min(rawEstimate, maxPersons);
  const estimateMinutes = Math.max(
    1,
    Math.round(estimateShown / PERSONS_PER_SECOND / 60),
  );
  const isDefault =
    ascend === DEFAULT_ASCEND &&
    descend === DEFAULT_DESCEND &&
    collateral === DEFAULT_COLLATERAL &&
    maxPersons === DEFAULT_IMPORT_PERSONS;
  const resetDefaults = (): void => {
    setAscend(DEFAULT_ASCEND);
    setDescend(DEFAULT_DESCEND);
    setCollateral(DEFAULT_COLLATERAL);
    setMaxPersons(DEFAULT_IMPORT_PERSONS);
  };

  // The Import button first shows the what-happens-when notice; the actual
  // kick-off lives in reallyRunImport, fired from the confirm dialog.
  const runImport = (): void => setConfirmOpen(true);
  const reallyRunImport = (): void => {
    // Kick off in the background (store) so it survives closing the dialog,
    // switch to the tree, and let the user watch it grow via the pill.
    void startFsImport({
      ascend,
      childrenDepth: descend,
      depth: collateral,
      treeId,
      root: rootFid.trim() || undefined,
      maxPersons,
    });
    setView("tree");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy === "signin") return;
        // In the start flow, block every dismissal (X / Esc / outside click) so
        // a failed login never drops the user onto an empty dashboard.
        if (!v && mandatory && !bailed.current) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        // The scope section made this the tallest dialog in the app. The shared
        // DialogContent is vertically CENTRED with no height limit, so on a
        // laptop screen it overflowed off the top AND the bottom — the title and
        // the import button were both unreachable. Cap it and scroll inside.
        // Header and footer stay PINNED; only the middle scrolls. The footer
        // carries the import button and the FamilySearch branding, so neither
        // can ever be pushed off-screen on a small window — the brand lockup
        // must stay visible, and the primary action must never need scrolling.
        className="flex max-h-[92dvh] max-w-4xl flex-col gap-3 overflow-hidden"
        hideClose={mandatory}
        onEscapeKeyDown={(e) =>
          mandatory && !bailed.current && e.preventDefault()
        }
        onInteractOutside={(e) =>
          mandatory && !bailed.current && e.preventDefault()
        }
      >
        <DialogHeader>
          {/* Brand-guide lockup: our own name stays dominant, the relationship
              is stated as "works with", and FamilySearch is represented by its
              official full-colour logo (min 32 pt, with clear space). */}
          <DialogTitle className="pr-8">
            <FsWorksWithHeader />
          </DialogTitle>
        </DialogHeader>

        <div className="-mr-2 flex-1 overflow-y-auto pr-2">
        {!configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("fs.noClientId")}</span>
          </div>
        ) : !signedIn ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("fs.signInHelp")}
            </p>
            <Button
              onClick={() => void signIn()}
              disabled={busy !== null}
              className="w-full gap-2"
            >
              {busy === "signin" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {t("fs.signInBtn")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t("fs.connected")}</span>
              <button
                onClick={() => void runThrottleProbe()}
                disabled={probing}
                className="text-xs underline opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
              >
                {probing ? t("fs.probeRunning") : t("fs.probeBtn")}
              </button>
              <button
                onClick={() => void signOut()}
                className="text-xs underline opacity-70 transition-opacity hover:opacity-100"
              >
                {t("fs.signOut")}
              </button>
            </div>

            {/* Two columns, not a stack: SCOPE on the left, target person +
                live estimate on the right — this is what lets a laptop window
                show the whole dialog with ZERO scrolling. On narrow windows it
                folds back to one column and the scroll container catches it. */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDescend(0);
                  setCollateral(0);
                }}
                disabled={busy !== null}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  descend === 0 && collateral === 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                {t("fs.directLineOnly")}
              </button>
              <button
                type="button"
                onClick={resetDefaults}
                disabled={busy !== null}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  isDefault
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("fs.resetDefaults")}
              </button>
            </div>
                <div className="space-y-2.5">
                  <ScopeSlider
                label={t("fs.ascLabel")}
                help={t("fs.ascHelp")}
                value={ascend}
                min={1}
                max={MAX_ASCEND}
                disabled={busy !== null}
                onChange={setAscend}
              />
              <ScopeSlider
                label={t("fs.descLabel")}
                help={t("fs.descHelp")}
                value={descend}
                min={0}
                max={MAX_DESCEND}
                disabled={busy !== null}
                onChange={setDescend}
              />
              <ScopeSlider
                label={t("fs.sideLabel")}
                help={t("fs.sideHelp")}
                value={collateral}
                min={0}
                max={MAX_COLLATERAL}
                disabled={busy !== null}
                danger={collateral > DEFAULT_COLLATERAL}
                badge={
                  collateral === DEFAULT_COLLATERAL
                    ? { text: t("fs.recommended"), tone: "good" }
                    : collateral > DEFAULT_COLLATERAL
                      ? { text: t("fs.sideBadge"), tone: "warn" }
                      : null
                }
                onChange={setCollateral}
              />
              <ScopeSlider
                label={t("fs.maxLabel")}
                help={t("fs.maxHelp", { max: MAX_IMPORT_PERSONS })}
                value={maxPersons}
                min={50}
                max={MAX_IMPORT_PERSONS}
                step={50}
                disabled={busy !== null}
                onChange={setMaxPersons}
              />
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("fs.startPerson")}</p>
              <input
                value={rootFid}
                onChange={(e) => setRootFid(e.target.value.toUpperCase())}
                disabled={busy !== null}
                placeholder={t("fs.startPersonPlaceholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {rootCheck.status === "checking" && (
                <p className="text-xs text-muted-foreground">
                  {t("fs.startChecking")}
                </p>
              )}
              {rootCheck.status === "found" && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {rootCheck.name}
                  {rootCheck.lifespan ? ` · ${rootCheck.lifespan}` : ""}
                </p>
              )}
              {rootCheck.status === "notfound" && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                  {t("fs.startNotFound")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("fs.startPersonHint")}
              </p>
            </div>
                {trees.length > 1 && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("fs.chooseTree")}</p>
                    <select
                      value={treeId}
                      onChange={(e) => setTreeId(e.target.value)}
                      disabled={busy !== null}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {trees.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.kind === "global" ? t("fs.mainTree") : tr.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-2.5">
              {/* Live estimate + every warning the settings deserve. */}
              <p className="flex items-start gap-2 text-xs leading-relaxed">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium text-foreground">
                    {t("fs.estimate", {
                      people: estimateShown,
                      minutes: estimateMinutes,
                    })}
                  </span>
                  <br />
                  <span className="text-muted-foreground">
                    {t("fs.estimateNote")}
                  </span>
                </span>
              </p>

              {collateral >= MAX_COLLATERAL && (
                <p className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("fs.warnSideMax")}</span>
                </p>
              )}
              {overCap && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("fs.warnOverCap", { max: maxPersons })}</span>
                </p>
              )}
              {estimateMinutes >= 10 && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("fs.warnLong", { minutes: estimateMinutes })}</span>
                </p>
              )}
              <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("fs.warnBackground")}
                  <br />
                  <span className="font-medium text-foreground">
                    {t("fs.alwaysIncluded")}
                  </span>
                  <br />
                  {t("fs.priorityNote")}
                </span>
              </p>
            </div>
              </div>
            </div>
          </div>
        )}
        </div>

        {/* PINNED footer: the primary action and the Solutions Program lockup.
            Scrolling may hide settings, never the import button or the brand. */}
        <div className="shrink-0 space-y-2 border-t border-border/40 pt-3">
          {configured && signedIn && (
            <Button
              onClick={runImport}
              disabled={
                busy !== null ||
                rootCheck.status === "checking" ||
                rootCheck.status === "notfound"
              }
              className="w-full gap-2"
            >
              <Download className="h-4 w-4" />
              {t("fs.importBtn")}
            </Button>
          )}
          {mandatory && (
            <button
              onClick={switchToManual}
              className="mx-auto block text-xs text-muted-foreground underline underline-offset-2 transition-opacity hover:opacity-100 hover:text-foreground"
            >
              {t("fs.useManualInstead")}
            </button>
          )}
          {/* Credit-notice area: the Solutions Program tier logo plus the required
              trademark ownership notice. Neither implies sponsorship or endorsement. */}
          <div className="flex flex-col items-center gap-1.5">
            {/* 44 px ≈ 33 pt — the Brand Guide's 32 pt minimum must hold here too. */}
            <FsSolutionBadge height={44} />
            <FsTrademarkNotice className="text-center" />
            {/* §9 express prohibition — pinned, so it is visible in every state. */}
            <p className="text-center text-[10px] leading-snug text-muted-foreground/70">
              {t("fs.dataResaleNotice")}
            </p>
          </div>
        </div>
      </DialogContent>

      {/* Phase notice. The import fills the tree FIRST; sources, notes and
          photos arrive only in the final enrichment pass, and place
          standardization runs after that — someone watching the half-done
          state reported the missing photos and duplicate places as bugs. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("fs.confirmTitle")}
        confirmLabel={t("fs.confirmStart")}
        destructive={false}
        onConfirm={() => {
          setConfirmOpen(false);
          reallyRunImport();
        }}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>{t("fs.confirmPhase1")}</li>
          <li>{t("fs.confirmPhase2")}</li>
          <li>{t("fs.confirmPhase3")}</li>
        </ul>
      </ConfirmDialog>
    </Dialog>
  );
}
