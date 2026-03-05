"""Run a builder pipeline from the command line."""

import asyncio
import json

from ventureforge.builder.builder import BuilderPipeline
from ventureforge.core.database import get_session_factory, init_db
from ventureforge.core.schemas import BuilderInput, OpportunityThesis


async def main() -> None:
    await init_db()
    factory = get_session_factory()

    thesis = OpportunityThesis(
        title="Autonomous Revenue Cycle Agent for Independent Medical Practices",
        one_liner="AI agent that handles the entire billing-to-collection workflow for small medical practices",
        problem_statement="Independent medical practices lose 15-30% of revenue to billing errors and slow collections.",
        solution_concept="An agentic AI that autonomously manages claims, follows up on denials, and optimizes coding.",
        why_now="CMS interoperability rules and LLM capabilities have converged to make this possible.",
        why_agentic="Requires multi-step reasoning across coding, payer rules, and patient communication.",
        market_signal="$15B revenue cycle management market growing at 12% CAGR.",
        moat_hypothesis="Proprietary data flywheel from processing claims across practices.",
        biggest_risk="Regulatory compliance in healthcare billing.",
        comparable_companies=["Athenahealth", "Waystar", "Olive AI"],
        recommended_first_customer="Solo dermatology practices billing $500K-2M annually",
    )

    input_config = BuilderInput(
        opportunity=thesis,
        target_audience="seed VC",
        depth="investor_ready",
    )

    async with factory() as session:
        pipeline = BuilderPipeline(session, dry_run=True)
        result = await pipeline.run(input_config)

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
