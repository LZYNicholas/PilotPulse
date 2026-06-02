import Link from "next/link";

export default function Home() {
  return (
    <main className="grid h-screen place-items-center overflow-hidden bg-[#212121] px-5 text-[#ececec]">
      <section className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold">PilotPulse</h1>
        <div className="mt-8 grid gap-3">
          <Link
            href="/job-seeker"
            className="rounded-xl border border-white/10 bg-[#2f2f2f] px-5 py-4 text-sm font-medium hover:bg-[#3a3a3a]"
          >
            Job seeker chat
          </Link>
          <Link
            href="/recruiter"
            className="rounded-xl border border-white/10 bg-[#2f2f2f] px-5 py-4 text-sm font-medium hover:bg-[#3a3a3a]"
          >
            Recruiter chat
          </Link>
        </div>
      </section>
    </main>
  );
}
