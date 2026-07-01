import { type FormEvent, useEffect, useState } from "react";
import { Loader2, UserCircle } from "lucide-react";
import { type AuthCheckResponse, validateMemberPasscode } from "@wwpdw/shared";
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

type Member = NonNullable<AuthCheckResponse["member"]>;

interface ProfileDialogProps {
  error: string;
  loading: boolean;
  member?: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, newPasscode?: string) => void;
}

export function ProfileDialog({
  error,
  loading,
  member,
  open,
  onOpenChange,
  onSubmit
}: ProfileDialogProps) {
  const [name, setName] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [localError, setLocalError] = useState("");

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
      setLocalError("请输入显示名称。");
      return;
    }

    if (nextPasscode) {
      const passcodeError = validateMemberPasscode(nextPasscode);
      if (passcodeError) {
        setLocalError(passcodeError);
        return;
      }

      if (nextPasscode !== confirmValue) {
        setLocalError("两次输入的新通行码不一致。");
        return;
      }
    }

    setLocalError("");
    onSubmit(nextName, nextPasscode || undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Update your display name and passcode.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Display name</Label>
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-passcode">New passcode</Label>
            <Input
              id="profile-passcode"
              autoComplete="new-password"
              maxLength={12}
              type="password"
              value={newPasscode}
              onChange={(event) => {
                setNewPasscode(event.target.value);
                setLocalError("");
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-confirm-passcode">Confirm new passcode</Label>
            <Input
              id="profile-confirm-passcode"
              autoComplete="new-password"
              maxLength={12}
              type="password"
              value={confirmPasscode}
              onChange={(event) => {
                setConfirmPasscode(event.target.value);
                setLocalError("");
              }}
            />
          </div>

          {localError || error ? <p className="text-sm font-semibold text-rose-300">{localError || error}</p> : null}

          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCircle className="h-4 w-4" />}
            Save profile
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
