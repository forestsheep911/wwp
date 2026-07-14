import { type FormEvent, useEffect, useState } from "react";
import { Loader2, LogOut, UserCircle } from "lucide-react";
import type { BrowserSession } from "../../api";
import { memberPasscodeLength, memberPasscodeStrengthHint, type AuthCheckResponse, validateMemberPasscode } from "@wwpdw/shared";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { copy } from "../i18n";

type Member = NonNullable<AuthCheckResponse["member"]>;

interface ProfileDialogProps {
  error: string;
  loading: boolean;
  member?: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, newPasscode?: string) => void;
  sessions?: BrowserSession[];
  sessionsLoading?: boolean;
  onRevokeSession?: (id: string) => void;
}

export function ProfileDialog({
  error,
  loading,
  member,
  open,
  onOpenChange,
  onSubmit,
  sessions = [],
  sessionsLoading = false,
  onRevokeSession
}: ProfileDialogProps) {
  const [name, setName] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [localError, setLocalError] = useState("");
  const passcodeStrengthHint = memberPasscodeStrengthHint(newPasscode.trim());

  useEffect(() => {
    if (open) {
      setName(member?.name ?? "");
      setNewPasscode("");
      setConfirmPasscode("");
      setLocalError("");
    }
  }, [member?.name, open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const nextPasscode = newPasscode.trim();
    const confirmValue = confirmPasscode.trim();

    if (!nextName) {
      setLocalError(copy.profile.errors.nameRequired);
      return;
    }

    if (nextPasscode) {
      const passcodeError = validateMemberPasscode(nextPasscode);
      if (passcodeError) {
        setLocalError(passcodeError);
        return;
      }

      if (nextPasscode !== confirmValue) {
        setLocalError(copy.profile.errors.passcodeMismatch);
        return;
      }
    }

    setLocalError("");
    onSubmit(nextName, nextPasscode || undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>{copy.profile.title}</DialogTitle>
          <DialogDescription>{copy.profile.description}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="profile-name">{copy.profile.displayName}</Label>
            <Input
              id="profile-name"
              autoComplete="name"
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setLocalError("");
              }}
            />
            {passcodeStrengthHint ? (
              <p className="text-xs leading-5 text-amber-600 dark:text-amber-300">{passcodeStrengthHint}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-passcode">{copy.profile.newPasscode}</Label>
            <Input
              id="profile-passcode"
              autoComplete="new-password"
              maxLength={memberPasscodeLength}
              type="password"
              value={newPasscode}
              onChange={(event) => {
                setNewPasscode(event.target.value);
                setLocalError("");
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-confirm-passcode">{copy.profile.confirmNewPasscode}</Label>
            <Input
              id="profile-confirm-passcode"
              autoComplete="new-password"
              maxLength={memberPasscodeLength}
              type="password"
              value={confirmPasscode}
              onChange={(event) => {
                setConfirmPasscode(event.target.value);
                setLocalError("");
              }}
            />
          </div>

          {localError || error ? <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200 sm:rounded">{localError || error}</p> : null}

          <Button className="w-full sm:w-auto" type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCircle className="h-4 w-4" />}
            {copy.profile.save}
          </Button>
        </form>
        <section className="grid gap-2 border-t border-slate-700/60 pt-4">
          <div>
            <h3 className="text-sm font-semibold">已登录的设备</h3>
            <p className="text-xs text-slate-400">可随时退出不再使用的浏览器；修改通行码会退出其他全部设备。</p>
          </div>
          {sessionsLoading ? <p className="text-sm text-slate-400">正在加载设备…</p> : sessions.map((session) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 px-3 py-2" key={session.id}>
              <div className="min-w-0 text-sm"><p className="truncate font-medium">{session.device ?? "未知设备"}{session.current ? "（当前设备）" : ""}</p><p className="truncate text-xs text-slate-400">最近活跃：{new Date(session.lastSeenAt).toLocaleString()}</p></div>
              <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => onRevokeSession?.(session.id)}><LogOut className="h-4 w-4" />退出</Button>
            </div>
          ))}
        </section>
      </DialogContent>
    </Dialog>
  );
}
