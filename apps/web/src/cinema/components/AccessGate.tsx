import { type FormEvent, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import type { AuthCheckResponse } from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  errorMessage,
  setAccessKey
} from "../../api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

export function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) {
      setError("Enter a Cinema Pass.");
      return;
    }

    setLoading(true);
    setError("");
    setAccessKey(candidate);
    try {
      const auth = await checkAccess();
      onUnlock(auth);
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(accessError, "Cinema Pass did not match."));
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
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="access-key">Cinema Pass</Label>
              <Input
                id="access-key"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                type="password"
              />
            </div>
            {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Enter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
