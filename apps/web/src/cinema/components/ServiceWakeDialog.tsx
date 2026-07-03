import { useEffect, useRef, useState } from "react";
import { Projector } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { copy } from "../i18n";

export const serviceWakeDelayMs = 1600;
const wakeChatMessageDelayMs = 4200;

type WakeChatMessage = {
  from: "gatekeeper" | "visitor";
  text: string;
};

function WakeAvatar({
  from,
  className = ""
}: {
  from: WakeChatMessage["from"];
  className?: string;
}) {
  const avatar = from === "visitor"
    ? { src: "/wake-visitor.png", alt: copy.access.wake.visitorAvatar }
    : { src: "/wake-gatekeeper.png", alt: copy.access.wake.gatekeeperAvatar };

  return (
    <img
      alt={avatar.alt}
      className={`h-8 w-8 shrink-0 rounded-full object-cover shadow-sm ${className}`}
      draggable={false}
      src={avatar.src}
    />
  );
}

function WakeGroupAvatar() {
  return (
    <img
      alt={copy.access.wake.groupAvatar}
      className="h-7 w-7 shrink-0 rounded-full object-cover shadow-sm ring-1 ring-emerald-300/30"
      draggable={false}
      src="/wake-group.png"
    />
  );
}

export function ServiceWakeDialog({
  open,
  onOpenChange,
  dismissible = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible?: boolean;
}) {
  const chatMessages: readonly WakeChatMessage[] = copy.access.wake.chat;
  const [messageStep, setMessageStep] = useState(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const visibleMessageCount = messageStep + 1;
  const visibleMessages = chatMessages.slice(0, visibleMessageCount);
  const typingFrom = chatMessages[(messageStep + 1) % chatMessages.length]?.from ?? "gatekeeper";
  const typingFromVisitor = typingFrom === "visitor";

  useEffect(() => {
    if (!open) {
      setMessageStep(0);
      return;
    }

    const timer = window.setInterval(() => {
      setMessageStep((currentStep) => currentStep >= chatMessages.length - 1 ? 0 : currentStep + 1);
    }, wakeChatMessageDelayMs);

    return () => window.clearInterval(timer);
  }, [chatMessages.length, open]);

  useEffect(() => {
    if (!open || !messageListRef.current) {
      return;
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messageStep, open]);

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
        className="max-h-[88vh] w-[min(92vw,390px)] overflow-hidden"
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
        onPointerDownOutside={(event) => {
          if (!dismissible) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Projector className="h-5 w-5 text-emerald-300" />
            {copy.access.wake.title}
          </DialogTitle>
        </DialogHeader>
        <div>
          <div className="relative flex h-[min(68vh,560px)] min-h-[420px] flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-950 p-3">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
            <div className="mb-3 flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <WakeGroupAvatar />
                <span className="text-xs font-semibold text-slate-200">{copy.access.wake.chatTitle}</span>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-hidden" ref={messageListRef}>
              {visibleMessages.map((message, index) => {
                const fromVisitor = message.from === "visitor";

                return (
                  <div
                    className={`flex items-end gap-2 ${fromVisitor ? "justify-end" : "justify-start"}`}
                    key={`${messageStep}-${index}-${message.text}`}
                  >
                    {!fromVisitor ? (
                      <WakeAvatar className="ring-1 ring-emerald-300/30" from="gatekeeper" />
                    ) : null}
                    <p
                      className={`max-w-[76%] rounded-2xl px-3 py-2 text-sm font-semibold leading-5 shadow-sm ${
                        fromVisitor
                          ? "rounded-br-sm bg-emerald-300 text-slate-950"
                          : "rounded-bl-sm border border-slate-700 bg-slate-900 text-slate-100"
                      }`}
                    >
                      {message.text}
                    </p>
                    {fromVisitor ? (
                      <WakeAvatar className="ring-1 ring-amber-300/30" from="visitor" />
                    ) : null}
                  </div>
                );
              })}
              <div className={`flex items-center gap-2 pt-1 ${typingFromVisitor ? "justify-end" : "justify-start"}`}>
                {!typingFromVisitor ? (
                  <WakeAvatar className="ring-1 ring-emerald-300/30" from="gatekeeper" />
                ) : null}
                <div
                  className={`flex w-fit gap-1 rounded-2xl px-3 py-2 ${
                    typingFromVisitor
                      ? "rounded-br-sm bg-emerald-300"
                      : "rounded-bl-sm border border-slate-700 bg-slate-900"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${typingFromVisitor ? "bg-slate-700" : "bg-slate-400"}`} />
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${typingFromVisitor ? "bg-slate-700" : "bg-slate-400"} [animation-delay:140ms]`} />
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${typingFromVisitor ? "bg-slate-700" : "bg-slate-400"} [animation-delay:280ms]`} />
                </div>
                {typingFromVisitor ? (
                  <WakeAvatar className="ring-1 ring-amber-300/30" from="visitor" />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
