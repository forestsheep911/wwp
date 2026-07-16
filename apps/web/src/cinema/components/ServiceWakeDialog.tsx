import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, Loader2, Pause, XCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import { copy } from "../i18n";
import { createWakeQuizOrder, wakeQuizQuestions } from "../wake-quiz";

export const serviceWakeDelayMs = 1600;
export const serviceWakeAutoNextDelayMs = 2000;

const optionLetters = ["A", "B", "C", "D"] as const;

export function ServiceWakeDialog({
  open,
  onOpenChange,
  dismissible = false,
  title
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible?: boolean;
  title?: string;
}) {
  const [quizOrder, setQuizOrder] = useState(() => createWakeQuizOrder());
  const [questionCursor, setQuestionCursor] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>();
  const [autoAdvancePaused, setAutoAdvancePaused] = useState(false);
  const advanceButtonRef = useRef<HTMLButtonElement>(null);
  const currentQuestion = wakeQuizQuestions[quizOrder[questionCursor] ?? 0];
  const answered = selectedIndex !== undefined;
  const autoAdvanceActive = answered && !autoAdvancePaused;
  const correctOption = currentQuestion.options[currentQuestion.answerIndex];
  const selectedOption = selectedIndex !== undefined ? currentQuestion.options[selectedIndex] : undefined;
  const isCorrect = selectedIndex === currentQuestion.answerIndex;

  const goToNextQuestion = useCallback(() => {
    setSelectedIndex(undefined);
    setAutoAdvancePaused(false);
    setQuestionCursor((currentCursor) => {
      const nextCursor = currentCursor + 1;

      if (nextCursor < quizOrder.length) {
        return nextCursor;
      }

      setQuizOrder(createWakeQuizOrder(Date.now()));
      return 0;
    });
  }, [quizOrder.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuizOrder(createWakeQuizOrder(Date.now()));
    setQuestionCursor(0);
    setSelectedIndex(undefined);
    setAutoAdvancePaused(false);
  }, [open]);

  useEffect(() => {
    if (answered) {
      advanceButtonRef.current?.focus();
    }
  }, [answered, questionCursor]);

  useEffect(() => {
    if (!autoAdvanceActive) {
      return;
    }

    const timer = window.setTimeout(goToNextQuestion, serviceWakeAutoNextDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoAdvanceActive, goToNextQuestion, questionCursor]);

  function answerQuestion(optionIndex: number) {
    if (selectedIndex !== undefined) {
      return;
    }

    setSelectedIndex(optionIndex);
    setAutoAdvancePaused(false);
  }

  function pauseAutoAdvance() {
    if (answered) {
      setAutoAdvancePaused(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || dismissible) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-0.75rem)] overflow-hidden p-0 sm:w-[min(94vw,520px)]"
        hideCloseButton={!dismissible}
        onEscapeKeyDown={(event) => {
          if (!dismissible) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (!dismissible) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!dismissible) {
            event.preventDefault();
          }
        }}
      >
        <div className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />
          <DialogHeader className="px-5 pb-2 pt-5">
            <DialogTitle className="flex items-center gap-2 text-base text-slate-50 sm:text-lg">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
              {title ?? copy.access.wake.title}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 px-5 pb-5 pt-2">
            <section className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl shadow-black/20 sm:rounded-md">
              <div className="flex items-center">
                <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">
                  {currentQuestion.category}
                </span>
              </div>

              <h2 className="min-h-[3.5rem] text-[1.05rem] font-semibold leading-7 text-slate-50 sm:text-lg">
                {currentQuestion.prompt}
              </h2>

              <div className="grid gap-2 sm:grid-cols-2">
                {currentQuestion.options.map((option, optionIndex) => {
                  const isSelected = selectedIndex === optionIndex;
                  const isAnswer = currentQuestion.answerIndex === optionIndex;
                  const optionState = !answered
                    ? "idle"
                    : isAnswer
                      ? "correct"
                      : isSelected
                        ? "wrong"
                        : "muted";

                  return (
                    <button
                      aria-disabled={answered}
                      aria-pressed={isSelected}
                      className={cn(
                        "group grid min-h-[4.75rem] grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-semibold leading-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:min-h-[4rem] sm:grid-cols-[2rem_minmax(0,1fr)] sm:rounded-md sm:py-2.5",
                        optionState === "idle" &&
                          "border-slate-700 bg-slate-900/70 text-slate-100 hover:border-emerald-300/70 hover:bg-slate-900",
                        optionState === "correct" &&
                          "border-emerald-300/70 bg-emerald-400/14 text-emerald-50 shadow-[0_0_0_1px_rgba(110,231,183,0.18)]",
                        optionState === "wrong" &&
                          "border-rose-300/70 bg-rose-400/14 text-rose-50 shadow-[0_0_0_1px_rgba(253,164,175,0.16)]",
                        optionState === "muted" && "border-slate-800 bg-slate-900/30 text-slate-500"
                      )}
                      key={`${currentQuestion.id}-${option}`}
                      onClick={() => answerQuestion(optionIndex)}
                      type="button"
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-black sm:h-8 sm:w-8 sm:rounded-md sm:text-xs",
                          optionState === "idle" && "border-slate-600 bg-slate-950 text-slate-300 group-hover:border-emerald-300/70 group-hover:text-emerald-100",
                          optionState === "correct" && "border-emerald-300/70 bg-emerald-300 text-slate-950",
                          optionState === "wrong" && "border-rose-300/80 bg-rose-300 text-slate-950",
                          optionState === "muted" && "border-slate-800 bg-slate-950 text-slate-600"
                        )}
                      >
                        {optionLetters[optionIndex]}
                      </span>
                      <span className="min-w-0">{option}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div
              className={cn(
                "min-h-[8.5rem] rounded-xl border p-4 transition sm:rounded-md",
                answered
                  ? isCorrect
                    ? "border-emerald-300/35 bg-emerald-400/10"
                    : "border-rose-300/35 bg-rose-400/10"
                  : "border-slate-800 bg-slate-900/35"
              )}
            >
              {answered ? (
                <div className="grid gap-3">
                  <div className="flex items-start gap-2">
                    {isCorrect ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                    ) : (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                    )}
                    <div className="min-w-0">
                      <p className={cn("font-semibold", isCorrect ? "text-emerald-100" : "text-rose-100")}>
                        {isCorrect ? copy.access.wake.correct : copy.access.wake.wrong}
                      </p>
                      {!isCorrect ? (
                        <p className="mt-1 text-sm leading-6 text-slate-200">
                          {copy.access.wake.yourAnswer}: {selectedOption ? `${optionLetters[selectedIndex]} ${selectedOption}` : copy.common.unknown}
                          <br />
                          {copy.access.wake.correctAnswer}: {optionLetters[currentQuestion.answerIndex]} {correctOption}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm leading-6 text-slate-400">{currentQuestion.note}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:flex sm:justify-end">
                    <Button
                      className="w-full sm:w-auto"
                      ref={advanceButtonRef}
                      size="sm"
                      type="button"
                      onClick={autoAdvancePaused ? goToNextQuestion : pauseAutoAdvance}
                    >
                      {autoAdvancePaused ? copy.access.wake.next : copy.access.wake.pause}
                      {autoAdvancePaused ? <ArrowRight className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[6.25rem] items-center gap-3 text-sm leading-6 text-slate-400">
                  <CircleHelp className="h-5 w-5 shrink-0 text-cyan-200" />
                  <p>{copy.access.wake.idle}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
