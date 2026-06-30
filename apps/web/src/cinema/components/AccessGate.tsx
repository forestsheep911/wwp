import { type FormEvent, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { type AuthCheckResponse, validateMemberPasscode } from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  errorMessage,
  registerMember,
  setAccessKey
} from "../../api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

export function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) {
      setError("Enter a passcode.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (mode === "register") {
        const nameValue = name.trim();
        const passcodeError = validateMemberPasscode(candidate);
        if (!nameValue) {
          setError("Enter a member name.");
          return;
        }
        if (passcodeError) {
          setError(passcodeError);
          return;
        }

        const response = await registerMember({
          name: nameValue,
          passcode: candidate
        });
        setAccessKey(candidate);
        onUnlock(response.auth);
        return;
      }

      setAccessKey(candidate);
      const auth = await checkAccess();
      onUnlock(auth);
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(accessError, mode === "register" ? "Could not register." : "Passcode did not match."));
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
          <CardTitle className="text-2xl">WW Family Cinema</CardTitle>
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
              Login
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
              Register
            </Button>
          </div>
          <form className="grid gap-4" onSubmit={submit}>
            {mode === "register" ? (
              <div className="grid gap-2">
                <Label htmlFor="member-name">Member name</Label>
                <Input
                  id="member-name"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="access-key">Passcode</Label>
              <Input
                id="access-key"
                autoFocus={mode === "login"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                maxLength={mode === "register" ? 12 : undefined}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                type="password"
              />
              {mode === "register" ? (
                <p className="text-xs leading-5 text-slate-500">
                  12 half-width characters, with at least 1 letter and 1 number.
                </p>
              ) : null}
            </div>
            {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "register" ? <UserPlus className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {mode === "register" ? "Create account" : "Enter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
