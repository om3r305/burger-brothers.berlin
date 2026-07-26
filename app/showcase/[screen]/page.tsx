import ShowcasePlayer from "@/components/showcase/ShowcasePlayer";

export default async function ShowcaseScreenPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  return <ShowcasePlayer screenSlug={screen} />;
}
