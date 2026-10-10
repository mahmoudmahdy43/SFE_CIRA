import { Card } from '../components/Card'

export default function Placeholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mb-6 mt-1 text-slate-500">{description}</p>
      <Card>
        <div className="py-10 text-center text-slate-400">
          Nothing here yet — this page will be built in a later phase.
        </div>
      </Card>
    </div>
  )
}
