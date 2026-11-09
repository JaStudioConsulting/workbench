import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  Building2,
  Contact,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command.tsx";
import {
  formatResultMetadata,
  resolveSearchNavigation,
  runWorkbenchSearch,
} from "./searchClient.js";

const ENTITY_ICONS = Object.freeze({
  candidate: Users,
  lead: Contact,
  job: Briefcase,
  client: Building2,
  note: FileText,
});

const defaultEvidenceLoader = async (searchState) => {
  const { loadSearchEvidence } = await import("./searchEvidence.js");
  return loadSearchEvidence(searchState);
};

const INITIAL_SEARCH_STATE = Object.freeze({
  phase: "idle",
  query: "",
  data: null,
  groups: Object.freeze([]),
  totalCount: 0,
  error: null,
});

export default function HeaderSearch({
  onSelectResult,
  onNavigatePage,
  searchRunner = runWorkbenchSearch,
  evidenceLoader = defaultEvidenceLoader,
  debounceMs = 160,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState(INITIAL_SEARCH_STATE);
  const [evidence, setEvidence] = useState({ phase: "idle", byId: {} });
  const [retryCounter, setRetryCounter] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const requestSeqRef = useRef(0);

  const focusInput = useCallback(() => {
    setOpen(true);
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        focusInput();
        return;
      }
      if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusInput, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestSeqRef.current += 1;
      setState(INITIAL_SEARCH_STATE);
      setEvidence({ phase: "idle", byId: {} });
      return undefined;
    }

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();

    setState((prev) => ({
      ...prev,
      phase: "loading",
      query: trimmed,
      error: null,
    }));
    setEvidence({ phase: "loading", byId: {} });

    const timer = window.setTimeout(() => {
      searchRunner(trimmed, { signal: controller.signal })
        .then(async (nextState) => {
          if (requestSeqRef.current !== currentSeq) return;
          setState(nextState);
          if (nextState.phase !== "ready") {
            setEvidence({ phase: "idle", byId: {} });
            return;
          }
          try {
            const byId = await evidenceLoader(nextState);
            if (requestSeqRef.current === currentSeq) {
              setEvidence({ phase: "ready", byId: byId || {} });
            }
          } catch {
            if (requestSeqRef.current === currentSeq) {
              setEvidence({ phase: "unavailable", byId: {} });
            }
          }
        })
        .catch((error) => {
          if (error?.name === "AbortError" || requestSeqRef.current !== currentSeq) return;
          setEvidence({ phase: "idle", byId: {} });
          setState({
            phase: "error",
            query: trimmed,
            data: null,
            groups: [],
            totalCount: 0,
            error: {
              code: error?.code || "SEARCH_FAILED",
              message: error instanceof Error ? error.message : "Workbench search could not be completed.",
              status: error?.status || 500,
            },
          });
        });
    }, Math.max(0, Number(debounceMs) || 0));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, retryCounter, searchRunner, evidenceLoader, debounceMs]);

  const handleQueryChange = (nextValue) => {
    setQuery(nextValue);
    if (!open) setOpen(true);
  };

  const handleClear = () => {
    setQuery("");
    setState(INITIAL_SEARCH_STATE);
    setEvidence({ phase: "idle", byId: {} });
    inputRef.current?.focus();
  };

  const handleSelectItem = (item, rawItem) => {
    const target = resolveSearchNavigation(rawItem || item);
    setOpen(false);
    if (target && typeof onSelectResult === "function") {
      onSelectResult(target, rawItem || item);
    }
  };

  const retrySearch = () => {
    setRetryCounter((value) => value + 1);
  };

  return (
    <div
      ref={containerRef}
      role="search"
      aria-label="Search Workbench"
      data-testid="header-search"
      className="relative w-full min-w-0 sm:w-64 md:w-80 lg:w-96"
    >
      <Command
        shouldFilter={false}
        loop
        label="Search Workbench"
        className="overflow-visible rounded-lg! bg-transparent p-0"
      >
        <div className="relative flex items-center">
          <div className="w-full min-w-0 flex-1 [&_div[data-slot=command-input-wrapper]]:p-0 [&_input]:pr-16">
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={handleQueryChange}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
                  setOpen(true);
                }
              }}
              placeholder="Search candidates, leads, jobs, clients..."
              aria-label="Search candidates, leads, jobs, and clients"
              data-testid="header-search-input"
            />
          </div>
          <div className=" absolute right-2 flex items-center gap-1">
            {query ? (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                data-testid="header-search-clear"
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            <kbd
              onClick={focusInput}
              title="Press Command+K or Ctrl+K to search"
              className="hidden cursor-pointer select-none items-center rounded border bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex"
            >
              ⌘K
            </kbd>
          </div>
        </div>

        <div
          data-testid="header-search-panel"
          className={
            open
              ? "absolute left-0 right-0 top-full z-50 mt-1.5 w-full max-w-[calc(100vw-2rem)] rounded-xl border bg-popover text-popover-foreground shadow-lg sm:left-auto sm:right-0 sm:w-[460px] md:w-[520px]"
              : "hidden"
          }
        >
          <CommandList
            label="Workbench search results"
            className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5"
          >
            {state.phase === "idle" ? (
              <div
                data-testid="search-idle-state"
                className="px-3 py-4 text-xs text-muted-foreground"
              >
                Type a role, skill, company, or name to search Candidates, Leads, Jobs, and Clients.
              </div>
            ) : null}

            {state.phase === "loading" ? (
              <div
                role="status"
                aria-live="polite"
                data-testid="search-loading-state"
                className="flex items-center gap-2 px-3 py-5 text-xs font-medium text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Searching Workbench...</span>
              </div>
            ) : null}

            {state.phase === "auth_error" && state.error ? (
              <div
                role="alert"
                data-testid="search-auth-error"
                className="m-1 rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-xs text-amber-950"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-800" aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">
                      {state.error.code === "FORBIDDEN" ? "Search access denied" : "Sign in required to search"}
                    </p>
                    <p className="text-amber-900">{state.error.message}</p>
                    {typeof onNavigatePage === "function" ? (
                      <div className="pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setOpen(false);
                            onNavigatePage("Settings");
                          }}
                        >
                          Open Settings
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {state.phase === "migration_required" && state.error ? (
              <div
                role="alert"
                data-testid="search-migration-required"
                className="m-1 rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-xs text-amber-950"
              >
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 size-4 shrink-0 text-amber-800" aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">Search migration required</p>
                    <p className="text-amber-900">{state.error.message}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {state.phase === "error" && state.error ? (
              <div
                role="alert"
                data-testid="search-error"
                className="m-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Search unavailable</p>
                      <p className="mt-0.5">{state.error.message}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={retrySearch}
                    className="h-7 shrink-0 text-xs"
                  >
                    <RefreshCw className="size-3" aria-hidden="true" />
                    <span>Retry</span>
                  </Button>
                </div>
              </div>
            ) : null}

            {state.phase === "empty" || state.phase === "ready" ? (
              <div className="space-y-1">
                {state.phase === "empty" ? (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="search-empty-state"
                    className="px-3 py-2 text-xs font-medium text-muted-foreground"
                  >
                    No matching records for &ldquo;{state.query}&rdquo;.
                  </div>
                ) : null}

                {state.groups.map((group) => {
                  const Icon = ENTITY_ICONS[group.entityType] || FileText;
                  return (
                    <CommandGroup
                      key={group.key}
                      heading={`${group.label} (${group.items.length})`}
                      data-testid={`search-group-${group.key}`}
                      forceMount
                    >
                      {group.items.length === 0 ? (
                        <div
                          data-testid={`search-group-empty-${group.key}`}
                          className="px-2 py-1.5 text-xs text-muted-foreground"
                        >
                          {group.emptyText}
                        </div>
                      ) : (
                        group.items.map((item, index) => {
                          const rawItem = group.rawItems[index];
                          const metadataLine = formatResultMetadata(item);
                          const candidateEvidence = item.entityType === "candidate" ? evidence.byId[item.entityId] : null;
                          return (
                            <CommandItem
                              key={item.id}
                              value={item.id}
                              onSelect={() => handleSelectItem(item, rawItem)}
                              data-testid={`search-result-${item.entityType}`}
                              data-result-id={item.id}
                              data-entity-type={item.entityType}
                              data-entity-id={item.entityId}
                              className="flex items-start gap-2.5 rounded-md px-2 py-2"
                            >
                              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <span className="truncate text-xs font-semibold text-foreground">
                                    {item.displayTitle}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {item.sourceLabel ? (
                                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                        {item.sourceLabel}
                                      </Badge>
                                    ) : item.status ? (
                                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                        {item.status}
                                      </Badge>
                                    ) : null}
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      {item.entityType === "job" ? `#${item.entityId}` : item.entityId}
                                    </span>
                                  </div>
                                </div>
                                {metadataLine ? (
                                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {metadataLine}
                                  </p>
                                ) : null}
                                {item.entityType === "candidate" ? (
                                  <div className="mt-1 space-y-0.5 text-[11px]" data-testid="search-candidate-evidence">
                                    {evidence.phase === "loading" ? (
                                      <p className="text-muted-foreground">Checking presentation history and open jobs...</p>
                                    ) : candidateEvidence ? (
                                      <>
                                        <p className={candidateEvidence.presentationStatus === "presented" ? "font-semibold text-blue-800" : "text-muted-foreground"}>
                                          {candidateEvidence.presentationLabel}
                                        </p>
                                        {candidateEvidence.pendingLabel ? <p className="text-amber-800">{candidateEvidence.pendingLabel}</p> : null}
                                        {candidateEvidence.matchesStatus === "loaded" ? (
                                          candidateEvidence.matches.length ? (
                                            <ul className="space-y-0.5" data-testid="search-best-job-matches">
                                              {candidateEvidence.matches.map((match) => (
                                                <li key={match.jobId} className="text-foreground">
                                                  <span className="font-semibold">{match.jobTitle}</span>
                                                  {match.company ? ` · ${match.company}` : ""}
                                                  {match.level ? ` · ${match.level}` : ""}
                                                  {match.reasons.length ? ` · ${match.reasons.slice(0, 2).join("; ")}` : ""}
                                                </li>
                                              ))}
                                            </ul>
                                          ) : <p className="text-muted-foreground">No supported open job match</p>
                                        ) : <p className="text-muted-foreground">Open job matches unavailable</p>}
                                      </>
                                    ) : (
                                      <p className="text-muted-foreground">Presentation history and job matches unavailable</p>
                                    )}
                                  </div>
                                ) : null}
                                {item.snippet ? (
                                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/90">
                                    {item.snippet}
                                  </p>
                                ) : null}
                              </div>
                            </CommandItem>
                          );
                        })
                      )}
                    </CommandGroup>
                  );
                })}
              </div>
            ) : null}
          </CommandList>
        </div>
      </Command>
    </div>
  );
}

export { HeaderSearch, formatResultMetadata };
