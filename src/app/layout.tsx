import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Visage · Editor de caras",
  description: "Edita tus selfies como en FaceApp: edad, sonrisa, retoque, forma, maquillaje, gafas, cabello, fondo y filtros.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Visage" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
  // Next only emits the newer "mobile-web-app-capable"; iOS still reads the Apple one for the
  // full-screen home-screen app with the translucent status bar.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geist.variable} h-full bg-black antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
