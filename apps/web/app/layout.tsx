import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { AuthInitializer } from "@/features/auth";
import { WSProvider } from "@/features/realtime";
import { ModalRegistry } from "@/features/modals";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Multica",
  description: "AI-native task management",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased font-sans h-full overflow-hidden", geist.variable, geistMono.variable)}
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <AuthInitializer>
            <WSProvider>{children}</WSProvider>
          </AuthInitializer>
          <ModalRegistry />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
