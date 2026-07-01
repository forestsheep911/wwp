import { type FormEvent, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { validateMemberPasscode } from "@wwpdw/shared";
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

interface PasscodeDialogProps {
  error: string;
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (currentPasscode: string, newPasscode: string) => void;
}

export function PasscodeDialog({
  error,
  loading,
  open,
  onOpenChange,
  onSubmit
}: PasscodeDialogProps) {
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setCurrentPasscode("");
      setNewPasscode("");
      setConfirmPasscode("");
      setLocalError("");
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const currentValue = currentPasscode.trim();
    const newValue = newPasscode.trim();
    const confirmValue = confirmPasscode.trim();
    const passcodeError = validateMemberPasscode(newValue);

    if (!currentValue) {
      setLocalError(copy.passcode.errors.currentRequired);
      return;
    }

    if (passcodeError) {
      setLocalError(passcodeError);
      return;
    }

    if (newValue !== confirmValue) {
      setLocalError(copy.passcode.errors.mismatch);
      return;
    }

    setLocalError("");
    onSubmit(currentValue, newValue);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.passcode.title}</DialogTitle>
          <DialogDescription>{copy.access.passcodeRule}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="current-passcode">{copy.passcode.current}</Label>
            <Input
              id="current-passcode"
              autoComplete="current-password"
              autoFocus
              type="password"
              value={currentPasscode}
              onChange={(event) => {
                setCurrentPasscode(event.target.value);
                setLocalError("");
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-passcode">{copy.passcode.new}</Label>
            <Input
              id="new-passcode"
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
            <Label htmlFor="confirm-passcode">{copy.passcode.confirmNew}</Label>
            <Input
              id="confirm-passcode"
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
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {copy.passcode.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
