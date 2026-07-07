import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Koala AI Design Studio",
  description:
    "Design your room with AI and shop the look — premium interior concepts from Koala Living.",
  icons: {
    icon: "/koala-logo.png",
    apple: "/koala-logo.png",
  },
  openGraph: {
    title: "Koala AI Design Studio",
    description:
      "Design your room with AI and shop the look — premium interior concepts from Koala Living.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
