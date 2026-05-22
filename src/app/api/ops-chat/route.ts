import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getInventorySummary,
  getRecommendations,
  searchInventory,
  getExecutiveSignals,
} from "@/lib/ops/inventory";

import {
  getOpsBrainSnapshot,
  getAgentExecutionPlan,
} from "@/lib/ops/brain";

import { getSupportSignals } from "@/lib/ops/support";
import { getLogisticsSignals } from "@/lib/ops/logistics";

export async function GET() {
  try {
    const executiveSignals = [
      ...getExecutiveSignals(),
      ...getSupportSignals(),
      ...getLogisticsSignals(),
    ];

    return NextResponse.json({
      summary: getInventorySummary(),
      recommendations: getRecommendations(),
      executiveSignals,
      orchestrationTimeline: getDefaultOrchestrationTimeline(),
    });
  } catch (error) {
    console.error("Failed to build ops chat snapshot", error);

    return NextResponse.json(
      { error: "Failed to load ops dashboard snapshot." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { message, module } = await req.json();
    const moduleName = typeof module === "string" ? module : "Executive";

    const matches = searchInventory(message || "");

    const brain = getOpsBrainSnapshot();
    const executionPlan = getAgentExecutionPlan(message || "");

    const context = {
      userQuestion: message,
      module: moduleName,
      brain,
      relevantMatches: matches,
    };

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        answer: "OPENAI_API_KEY is missing. Add it to .env.local first.",
        agents: defaultAgents(),
        workflow: executionPlan.map((step) => `${step.agent}: ${step.task}`),
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
You are KoalaOps AI, an agentic workflow orchestration assistant for a furniture retailer.

You are not a generic chatbot.

You act like a senior operations strategist coordinating specialist AI agents across:
- Inventory
- Warehouse
- Sales
- Marketing
- Customer Support
- Logistics
- Executive Management

Current module focus:
${getModuleSystemFocus(moduleName)}

Your job:
- detect operational risks
- connect signals across departments
- explain evidence
- recommend actions
- identify which department should act
- show business impact
- sound practical, commercial and executive-ready

Response format:
1. Summary
2. Top risks or opportunities
3. Recommended actions
4. Department handoffs
5. Business impact

Rules:
- Use only the provided operational data.
- Do not pretend simulated data is real.
- Be concise but powerful.
- Avoid generic AI language.
          `,
        },
        {
          role: "user",
          content: `
User question:
${message}

Operational data:
${JSON.stringify(context, null, 2)}
          `,
        },
      ],
    });

    return NextResponse.json({
      answer:
        completion.choices[0]?.message?.content ||
        "No AI response returned.",
      agents: defaultAgents(),
      workflow: executionPlan.map(
        (step) => `${step.agent}: ${step.task}`
      ),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ops AI failed",
      },
      { status: 500 }
    );
  }
}

function defaultAgents() {
  return [
    { name: "Inventory Agent", status: "analysed stock levels and movement" },
    { name: "Warehouse Agent", status: "checked warehouse and store locations" },
    { name: "Commercial Agent", status: "generated business recommendations" },
  ];
}

function getDefaultOrchestrationTimeline() {
  return [
    {
      step: "Inventory Agent detected stock risks",
      detail: "Low stock and overstock signals were identified from inventory data.",
    },
    {
      step: "Sales Agent generated commercial actions",
      detail: "Overstock products were converted into bundle and upsell opportunities.",
    },
    {
      step: "Marketing Agent prepared campaign ideas",
      detail: "Sales opportunities were converted into promotional campaign directions.",
    },
    {
      step: "Support Agent reviewed customer risk",
      detail: "Open tickets and negative sentiment were checked for customer impact.",
    },
    {
      step: "Logistics Agent checked supplier and shipment risk",
      detail: "Inbound shipment delays were reviewed for replenishment impact.",
    },
    {
      step: "Executive Orchestrator produced management summary",
      detail: "All module signals were combined into executive-level recommendations.",
    },
  ];
}

function getModuleSystemFocus(moduleName: string) {
  const focusByModule: Record<string, string> = {
    Executive:
      "Answer as a cross-department executive orchestrator across national stock, warehouse pressure, customer issues, supplier delays, sales opportunities and business impact.",
    Inventory:
      "Focus on stock levels, warehouse pressure, replenishment priorities, DIO, overstock, slow-moving stock and transfer opportunities.",
    Sales:
      "Focus on bundles, substitutions, margin, revenue opportunity, store selling priorities and preventing lost sales.",
    Marketing:
      "Focus on campaign ideas, audience, channel, promotions, bundle messaging and converting inventory pressure into demand.",
    Support:
      "Focus on tickets, sentiment, escalation priority, customer communication and which operational team should respond.",
    Logistics:
      "Focus on shipments, supplier delays, ETA risk, inbound replenishment, container status and stock availability impact.",
  };

  return focusByModule[moduleName] || focusByModule.Executive;
}
