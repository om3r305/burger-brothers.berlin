// app/tv/(protected)/layout.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Burger Brothers • TV",
  description: "Burger Brothers – Küchenmonitor",
  manifest: "/manifest-tv.webmanifest?v=5",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Burger TV",
  },
};

export default function TVProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();

  // 🔐 Server-side TV session cookie
  const tvSess = cookieStore.get("bb_tv_auth");

  // Cookie yoksa → login
  if (!tvSess) {
    redirect("/tv/login");
  }

  return (
    <div className="bb-operational-route bb-operational-route--tv-protected">
      {/* TV PWA manifest */}
      <link rel="manifest" href="/manifest-tv.webmanifest?v=5" />

      {/* Footer TV ekranında gizli */}
      <style
        dangerouslySetInnerHTML={{
          __html: `footer{display:none!important}`,
        }}
      />

      {children}
    </div>
  );
}
