import KasaClient from "./KasaClient";
import KasaScrollGuard from "./ScrollGuard";

export default function KasaPage() {
  return (
    <>
      <KasaClient />
      <KasaScrollGuard />
    </>
  );
}
