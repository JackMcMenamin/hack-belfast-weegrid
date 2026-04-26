type StreetOverviewPageProps = {
  searchParams: Promise<{ postcode?: string }>;
};

export default async function StreetOverviewPage({
  searchParams,
}: StreetOverviewPageProps) {
  const params = await searchParams;
  const postcode = params.postcode ?? "Unknown postcode";

  return (
    <main className="brand-page min-h-screen px-6 py-16 text-white">
      <section className="brand-panel mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-2xl p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-300">
          Step 2 | Street Overview
        </p>
        <h1 className="text-3xl font-bold">Street Overview (Coming Next)</h1>
        <p className="text-emerald-50/90">
          Postcode captured from landing:{" "}
          <span className="font-semibold text-green-200">{postcode}</span>
        </p>
        <p className="text-emerald-100/75">
          Next step is map + street assumptions form with Belfast defaults.
        </p>
      </section>
    </main>
  );
}
