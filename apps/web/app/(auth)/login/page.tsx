"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { api } from "@/shared/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

function LoginPageContent() {
  const router = useRouter();
  const sendCode = useAuthStore((s) => s.sendCode);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrateWorkspace);
  const searchParams = useSearchParams();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email) {
      setError("Email is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await sendCode(email);
      setStep("code");
      setCode("");
      setCooldown(60);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send code. Make sure the server is running."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = useCallback(
    async (value: string) => {
      if (value.length !== 6) return;
      setError("");
      setSubmitting(true);
      try {
        const cliCallback = searchParams.get("cli_callback");
        if (cliCallback) {
          // CLI browser login: verify code, get JWT, redirect to CLI callback.
          // Only allow http://localhost callbacks to prevent open redirect / JWT theft.
          try {
            const cbUrl = new URL(cliCallback);
            if (cbUrl.protocol !== "http:") {
              setError("Invalid callback URL");
              setSubmitting(false);
              return;
            }
            if (cbUrl.hostname !== "localhost" && cbUrl.hostname !== "127.0.0.1") {
              setError("Invalid callback URL");
              setSubmitting(false);
              return;
            }
          } catch {
            setError("Invalid callback URL");
            setSubmitting(false);
            return;
          }
          const { token } = await api.verifyCode(email, value);
          const cliState = searchParams.get("cli_state") || "";
          const separator = cliCallback.includes("?") ? "&" : "?";
          window.location.href = `${cliCallback}${separator}token=${encodeURIComponent(token)}&state=${encodeURIComponent(cliState)}`;
          return;
        }

        await verifyCode(email, value);
        const wsList = await api.listWorkspaces();
        await hydrateWorkspace(wsList);
        router.push(searchParams.get("next") || "/issues");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Invalid or expired code"
        );
        setCode("");
        setSubmitting(false);
      }
    },
    [email, verifyCode, hydrateWorkspace, router, searchParams]
  );

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      await sendCode(email);
      setCooldown(60);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to resend code"
      );
    }
  };

  if (step === "code") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              We sent a verification code to{" "}
              <span className="font-medium text-foreground">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) handleVerifyCode(value);
              }}
              disabled={submitting}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0}
                className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Back
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Multica</CardTitle>
          <CardDescription>AI-native task management</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="login-form" onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </form>
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            form="login-form"
            disabled={submitting}
            className="w-full"
            size="lg"
          >
            {submitting ? "Sending code..." : "Continue"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
