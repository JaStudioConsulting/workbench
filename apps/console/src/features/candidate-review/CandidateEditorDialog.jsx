import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Eraser, Loader2 } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import {
  CANDIDATE_FORM_FIELD_CONFIGS,
  createCandidate,
  createInitialCandidateFormValues,
  describeCandidateProvenance,
  getCachedCandidateRecord,
  getCandidateById,
  readCandidateFieldValue,
  updateCandidate,
} from "./candidateEditorService.js";

export default function CandidateEditorDialog({
  open,
  onOpenChange,
  mode = "create",
  candidate = null,
  onSaved,
  client,
  fetchImpl,
}) {
  const [baselineRecord, setBaselineRecord] = useState(() => (
    mode === "edit" ? (getCachedCandidateRecord(candidate?.id) || candidate) : null
  ));
  const [formValues, setFormValues] = useState(() => (
    createInitialCandidateFormValues(mode === "edit" ? (getCachedCandidateRecord(candidate?.id) || candidate) : null, { mode })
  ));
  const [dirtyFields, setDirtyFields] = useState(() => new Set());
  const [clearedFields, setClearedFields] = useState(() => new Set());
  const [hydrating, setHydrating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const dirtyFieldsRef = useRef(dirtyFields);
  dirtyFieldsRef.current = dirtyFields;

  const provenance = useMemo(
    () => describeCandidateProvenance(baselineRecord || candidate, { mode }),
    [baselineRecord, candidate, mode],
  );

  const visibleFields = useMemo(
    () => CANDIDATE_FORM_FIELD_CONFIGS.filter((field) => !(provenance.isManual && field.trackerOnly)),
    [provenance.isManual],
  );

  useEffect(() => {
    if (!open) return undefined;
    const cached = mode === "edit" ? (getCachedCandidateRecord(candidate?.id) || candidate) : null;
    setBaselineRecord(cached);
    setFormValues(createInitialCandidateFormValues(cached, { mode }));
    setDirtyFields(new Set());
    setClearedFields(new Set());
    setErrorMessage("");
    setFieldErrors({});

    if (mode !== "edit" || !candidate?.id) {
      setHydrating(false);
      return undefined;
    }

    const targetProvenance = describeCandidateProvenance(cached, { mode: "edit" });
    if (targetProvenance.invalidKey) {
      setHydrating(false);
      return undefined;
    }

    let active = true;
    setHydrating(true);
    getCandidateById(candidate.id, {
      ...(client ? { client } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    })
      .then((freshRecord) => {
        if (!active || !freshRecord) return;
        setBaselineRecord(freshRecord);
        const freshValues = createInitialCandidateFormValues(freshRecord, { mode: "edit" });
        setFormValues((current) => {
          const next = { ...current };
          for (const [key, val] of Object.entries(freshValues)) {
            if (!dirtyFieldsRef.current.has(key)) {
              next[key] = val;
            }
          }
          return next;
        });
      })
      .catch((error) => {
        if (!active) return;
        if (error?.status && error.status !== 401) {
          setErrorMessage(error.message || "Candidate details could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setHydrating(false);
      });

    return () => {
      active = false;
    };
  }, [open, mode, candidate?.id, client, fetchImpl]);

  const handleFieldChange = (fieldKey) => (event) => {
    const nextValue = event.target.value;
    setFormValues((current) => ({ ...current, [fieldKey]: nextValue }));
    setDirtyFields((current) => new Set([...current, fieldKey]));
    setClearedFields((current) => {
      const next = new Set(current);
      if (String(nextValue).trim() === "") {
        if (fieldKey !== "candidate_name") next.add(fieldKey);
      } else {
        next.delete(fieldKey);
      }
      return next;
    });
    if (fieldErrors[fieldKey]) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[fieldKey];
        return next;
      });
    }
  };

  const handleClearField = (fieldKey) => {
    if (fieldKey === "candidate_name") return;
    setFormValues((current) => ({ ...current, [fieldKey]: "" }));
    setDirtyFields((current) => new Set([...current, fieldKey]));
    setClearedFields((current) => new Set([...current, fieldKey]));
    if (fieldErrors[fieldKey]) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[fieldKey];
        return next;
      });
    }
  };

  const handleSaveForm = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrorMessage("");
    setFieldErrors({});

    try {
      const requestOptions = {
        ...(client ? { client } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
      };
      let savedRecord;
      if (mode === "create") {
        savedRecord = await createCandidate(formValues, requestOptions);
      } else {
        const explicitClears = new Set(clearedFields);
        for (const key of dirtyFields) {
          if (key !== "candidate_name" && String(formValues[key] ?? "").trim() === "") {
            explicitClears.add(key);
          }
        }
        savedRecord = await updateCandidate(candidate?.id, formValues, {
          ...requestOptions,
          baseline: baselineRecord || candidate,
          clearedFields: [...explicitClears],
        });
      }
      onSaved?.(savedRecord);
      onOpenChange?.(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Candidate could not be saved.");
      if (error?.fieldErrors && typeof error.fieldErrors === "object") {
        setFieldErrors(error.fieldErrors);
      }
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = mode === "create"
    ? "Add candidate"
    : provenance.isManual
      ? "Edit manual candidate"
      : "Edit candidate overlay";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onOpenChange?.(false);
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-testid="candidate-editor-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSaveForm} noValidate data-testid="candidate-editor-form">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{dialogTitle}</DialogTitle>
              <Badge
                variant="outline"
                className={
                  provenance.isManual
                    ? "border-emerald-400 bg-emerald-50 text-emerald-900 text-[11px]"
                    : "border-amber-400 bg-amber-50 text-amber-900 text-[11px]"
                }
                data-testid="candidate-provenance-badge"
              >
                {provenance.badgeLabel}
              </Badge>
              {provenance.id ? (
                <Badge variant="outline" className="text-[11px] font-mono" data-testid="candidate-source-key-badge">
                  {provenance.id}
                </Badge>
              ) : null}
            </div>
            <DialogDescription data-testid="candidate-provenance-description">
              {provenance.description}
            </DialogDescription>
          </DialogHeader>

          {hydrating ? (
            <div
              role="status"
              className="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              data-testid="candidate-editor-loading"
            >
              <Loader2 size={13} className="animate-spin" />
              <span>Loading latest candidate record...</span>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
              data-testid="candidate-editor-error"
            >
              <AlertCircle size={14} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="grid gap-3 py-4 sm:grid-cols-2">
            {visibleFields.map((field) => {
              const inputId = `candidate-field-${field.key}`;
              const errorId = `candidate-error-${field.key}`;
              const currentValue = formValues[field.key] ?? "";
              const baselineValue = mode === "edit"
                ? readCandidateFieldValue(baselineRecord || candidate, field.key)
                : null;
              const willClearToNull = mode === "edit"
                && !field.required
                && (clearedFields.has(field.key) || (baselineValue !== null && String(currentValue).trim() === ""));
              const canClear = mode === "edit"
                && !field.required
                && (String(currentValue).length > 0 || baselineValue !== null);
              const isFullWidth = field.type === "textarea" || field.key === "profile_url" || field.key === "compensation_context";

              return (
                <div key={field.key} className={`grid gap-1.5 ${isFullWidth ? "sm:col-span-2" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={inputId} className="text-xs font-semibold">
                      {field.label}
                      {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                      {field.trackerOnly ? (
                        <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(Tracker overlay)</span>
                      ) : null}
                    </Label>
                    <div className="flex items-center gap-1.5">
                      {willClearToNull ? (
                        <span
                          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
                          data-testid={`null-indicator-${field.key}`}
                        >
                          Clears to null
                        </span>
                      ) : null}
                      {canClear ? (
                        <button
                          type="button"
                          onClick={() => handleClearField(field.key)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Clear ${field.label}`}
                          data-testid={`clear-field-${field.key}`}
                        >
                          <Eraser size={11} />
                          <span>Clear</span>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {field.type === "textarea" ? (
                    <Textarea
                      id={inputId}
                      rows={3}
                      maxLength={field.maxLength}
                      value={currentValue}
                      onChange={handleFieldChange(field.key)}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      aria-describedby={fieldErrors[field.key] ? errorId : undefined}
                      className="text-xs"
                      data-testid={`input-${field.key}`}
                    />
                  ) : (
                    <Input
                      id={inputId}
                      type={field.type}
                      required={field.required}
                      maxLength={field.maxLength}
                      value={currentValue}
                      onChange={handleFieldChange(field.key)}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      aria-describedby={fieldErrors[field.key] ? errorId : undefined}
                      placeholder={field.key === "profile_url" ? "https://..." : undefined}
                      className="h-8 text-xs"
                      data-testid={`input-${field.key}`}
                    />
                  )}

                  {fieldErrors[field.key] ? (
                    <p id={errorId} className="text-[11px] font-medium text-destructive">
                      {fieldErrors[field.key]}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange?.(false)}
              disabled={saving}
              data-testid="candidate-editor-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              data-testid="candidate-editor-save"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="mr-1.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : mode === "create" ? (
                "Add candidate"
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
