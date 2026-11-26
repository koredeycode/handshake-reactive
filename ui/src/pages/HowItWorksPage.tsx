import HowItWorks from '../components/HowItWorks'

export default function HowItWorksPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Protocol design</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          Why a reactive contract can be the neutral arbiter for cross-chain OTC settlement — and where the guarantee stops.
        </p>
      </div>
      <HowItWorks />
    </div>
  )
}
