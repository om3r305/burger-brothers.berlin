// app/tv/layout.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Burger Brothers • TV",
  description: "Burger Brothers – Küchenmonitor",
  manifest: "/manifest-tv.webmanifest?v=5",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Burger TV" },
};

export default function TVLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const tvSess = cookieStore.get("bb_tv_sess"); // session cookie (tarayıcı kapanınca biter)

  if (!tvSess) {
    redirect("/tv/login");
  }

  return (
    <div>
      <link rel="manifest" href="/manifest-tv.webmanifest?v=5" />
      <style dangerouslySetInnerHTML={{ __html: `footer{display:none!important}` }} />
      {children}
    </div>
  );
}
