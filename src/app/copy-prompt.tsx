"use client";

import { Button } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyPrompt({ prompt, label, copiedLabel, errorLabel }: {
  prompt: string;
  label: string;
  copiedLabel: string;
  errorLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="prompt-box">
      <p className="prompt-text">{prompt}</p>
      <Button variant="secondary" className="copy-prompt-button" onPress={copy}>
        {status === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {label}
      </Button>
      <span className="copy-prompt-status" role="status">
        {status === "copied" ? copiedLabel : status === "error" ? errorLabel : ""}
      </span>
    </div>
  );
}
