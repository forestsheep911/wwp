import { type FormEvent, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, UserPlus } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { copy } from "../i18n";

type AccessMode = "login" | "register" | "reset";

function initialInviteState(): { mode: AccessMode; inviteCode: string } {
  if (typeof window === "undefined") {
    return {
      mode: "login",
      inviteCode: ""
    };
  }

  const params = new URLSearchParams(window.location.search);
  const resetCode = (params.get("reset") ?? params.get("resetInvite") ?? "").trim();
  if (resetCode) {
    return {
      mode: "reset",
      inviteCode: resetCode
    };
  }

  const signupCode = (params.get("invite") ?? params.get("signup") ?? params.get("signupInvite") ?? "").trim();
  if (signupCode) {
    return {
      mode: "register",
      inviteCode: signupCode
    };
  }

  return {
    mode: "login",
    inviteCode: ""
  };
}

export function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse, options?: { openProfile?: boolean }) => void }) {
  const [initialInvite] = useState(initialInviteState);
  const [mode, setMode] = useState<AccessMode>(initialInvite.mode);
  const [inviteCode, setInviteCode] = useState(initialInvite.inviteCode);
  const [value, setValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (mode !== "register" && !candidate) {
      setError(mode === "login" ? copy.access.errors.enterPasscode : copy.access.errors.enterNewPasscode);
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (mode === "register") {
        const inviteValue = inviteCode.trim();
        if (!inviteValue) {
          setError(copy.access.errors.enterInvite);
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
          setError(copy.access.errors.enterResetInvite);
          return;
        }
        if (passcodeError) {
          setError(passcodeError);
          return;
        }
        if (candidate !== confirmCandidate) {
          setError(copy.access.errors.mismatch);
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
          ? copy.access.errors.registerFailed
          : mode === "reset"
            ? copy.access.errors.resetFailed
            : copy.access.errors.passcodeMismatch
      ));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <img alt="" className="mb-4 h-14 w-14 rounded-xl" src="/wwp-icon-192.png" />
          <CardTitle className="text-3xl">{copy.app.name}</CardTitle>
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
              {copy.access.enter}
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
              {copy.access.join}
            </Button>
          </div>
          <form className="grid gap-4" onSubmit={submit}>
            {mode !== "login" ? (
              <div className="grid gap-2">
                <Label htmlFor="invite-code">{mode === "register" ? copy.access.householdInvitation : copy.access.resetInvitation}</Label>
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
                <Label htmlFor="access-key">{mode === "login" ? copy.access.passcode : copy.access.newPasscode}</Label>
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
                    {copy.access.passcodeRule}
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
                    {copy.access.forgot}
                  </button>
                ) : null}
              </div>
            ) : null}
            {mode === "reset" ? (
              <p className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs leading-5 text-slate-400">
                {copy.access.resetHelp}
              </p>
            ) : null}
            {mode === "reset" ? (
              <div className="grid gap-2">
                <Label htmlFor="confirm-access-key">{copy.access.confirmPasscode}</Label>
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
              {mode === "register" ? copy.access.joinHousehold : mode === "reset" ? copy.access.resetPasscode : copy.access.enter}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
