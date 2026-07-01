import { type FormEvent, useState } from "react";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { type AuthCheckResponse, validateMemberPasscode } from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  errorMessage,
  registerMember,
  resetMemberPasscode,
  setAccessKey
} from "../../api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

export function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse, options?: { openProfile?: boolean }) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [inviteCode, setInviteCode] = useState("");
  const [value, setValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (mode !== "register" && !candidate) {
      setError(mode === "login" ? "Enter a passcode." : "Enter your new passcode.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (mode === "register") {
        const inviteValue = inviteCode.trim();
        if (!inviteValue) {
          setError("Enter a household invitation code.");
          return;
        }

        const response = await registerMember({
          inviteCode: inviteValue
        });
        setAccessKey(response.passcode);
        onUnlock(response.auth, { openProfile: true });
        return;
      }

      if (mode === "reset") {
        const inviteValue = inviteCode.trim();
        const confirmCandidate = confirmValue.trim();
        const passcodeError = validateMemberPasscode(candidate);
        if (!inviteValue) {
          setError("Enter a reset invitation code.");
          return;
        }
        if (passcodeError) {
          setError(passcodeError);
          return;
        }
        if (candidate !== confirmCandidate) {
          setError("The two passcodes do not match.");
          return;
        }

        const response = await resetMemberPasscode({
          inviteCode: inviteValue,
          newPasscode: candidate
        });
        setAccessKey(candidate);
        onUnlock({
          ok: true,
          role: "member",
          member: {
            id: response.code.id,
            name: response.code.name,
            credits: response.code.credits
          }
        });
        return;
      }

      setAccessKey(candidate);
      const auth = await checkAccess();
      onUnlock(auth);
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(
        accessError,
        mode === "register"
          ? "Could not register."
          : mode === "reset"
            ? "Could not reset passcode."
            : "Passcode did not match."
      ));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-200">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">WWP Cinema</CardTitle>
          <CardDescription>Private household screening room</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 rounded-md border border-slate-800 bg-slate-950 p-1">
            <Button
              type="button"
              variant={mode === "login" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              <ShieldCheck className="h-4 w-4" />
              Enter
            </Button>
            <Button
              type="button"
              variant={mode === "register" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              <UserPlus className="h-4 w-4" />
              Join
            </Button>
          </div>
          <form className="grid gap-4" onSubmit={submit}>
            {mode !== "login" ? (
              <div className="grid gap-2">
                <Label htmlFor="invite-code">{mode === "register" ? "Household invitation" : "Reset invitation"}</Label>
                <Input
                  id="invite-code"
                  autoFocus={mode === "register"}
                  autoComplete="one-time-code"
                  value={inviteCode}
                  onChange={(event) => {
                    setInviteCode(event.target.value);
                    setError("");
                  }}
                />
              </div>
            ) : null}
            {mode !== "register" ? (
              <div className="grid gap-2">
                <Label htmlFor="access-key">{mode === "login" ? "Passcode" : "New passcode"}</Label>
                <Input
                  id="access-key"
                  autoFocus={mode === "login"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  maxLength={mode === "login" ? undefined : 12}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError("");
                  }}
                  type="password"
                />
                {mode === "reset" ? (
                  <p className="text-xs leading-5 text-slate-500">
                    12 half-width characters, with at least 1 letter and 1 number.
                  </p>
                ) : null}
                {mode === "login" ? (
                  <button
                    className="w-fit text-xs font-semibold text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    type="button"
                    onClick={() => {
                      setMode("reset");
                      setError("");
                      setInviteCode("");
                      setValue("");
                    }}
                  >
                    忘记了？
                  </button>
                ) : null}
              </div>
            ) : null}
            {mode === "reset" ? (
              <p className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs leading-5 text-slate-400">
                请输入管理员提供的重置码，然后设置新的通行码。如果你没有重置码，请先向管理员索要。
              </p>
            ) : null}
            {mode === "reset" ? (
              <div className="grid gap-2">
                <Label htmlFor="confirm-access-key">Confirm passcode</Label>
                <Input
                  id="confirm-access-key"
                  autoComplete="new-password"
                  maxLength={12}
                  value={confirmValue}
                  onChange={(event) => {
                    setConfirmValue(event.target.value);
                    setError("");
                  }}
                  type="password"
                />
              </div>
            ) : null}
            {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "register" ? <UserPlus className="h-4 w-4" /> : mode === "reset" ? <KeyRound className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {mode === "register" ? "Join household" : mode === "reset" ? "Reset pass" : "Enter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
