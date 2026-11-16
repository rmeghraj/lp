import { ClaimAssessment } from './components/ClaimAssessment.jsx'

export default function App() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Claims Intelligence Engine</h1>
        <p>Does this clinical study really justify this product claim?</p>
      </header>

      <main>
        <ClaimAssessment />
      </main>

      <footer className="page-footer">
        <p>The assessment is advice for the evaluator. It never approves a claim: a person decides.</p>
      </footer>
    </div>
  )
}
