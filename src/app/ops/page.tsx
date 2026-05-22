"use client";

import { useEffect, useState } from "react";

type Agent = { name: string; status: string };
type Recommendation = { type: string; title: string; action: string };

type ActionTicket = {
  id: string;
  owner: string;
  priority: string;
  score: number;
  task: string;
  reason: string;
  handoff: string;
  status: string;
};

type TicketWorkflowStatus = "approved" | "escalated" | "assigned";

type WorkflowActivityEntry = {
  id: string;
  message: string;
  timestamp: string;
};

type EnterpriseMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
};

type ScenarioResult = {
  title: string;
  expectedRisk: string;
  recommendedAction: string;
  estimatedBusinessImpact: string;
};

type OrchestrationStep = {
  step: string;
  detail: string;
};

type LogisticsItem = {
  id: string;
  supplier: string;
  product: string;
  origin: string;
  destination: string;
  status: string;
  eta: string;
  risk: string;
  reason: string;
  recommendedAction: string;
};

type LogisticsSummary = {
  totalShipments: number;
  delayed: LogisticsItem[];
  highRisk: LogisticsItem[];
  inTransit: LogisticsItem[];
  arrived: LogisticsItem[];
};

type SupportTicket = {
  id: string;
  customer: string;
  category: string;
  product: string;
  status: string;
  priority: string;
  sentiment: string;
  summary: string;
  recommendedAction: string;
};

type SupportSummary = {
  totalTickets: number;
  openTickets: SupportTicket[];
  highPriority: SupportTicket[];
  negativeSentiment: SupportTicket[];
  deliveryIssues: SupportTicket[];
};

type MarketingCampaign = {
  campaignType: string;
  title: string;
  sourceSignal: string;
  targetAudience: string;
  channel: string;
  message: string;
};

type SalesOpportunity = {
  type: string;
  product: string;
  reason: string;
  action: string;
  expectedImpact: string;
};

type ExecutiveSignal = {
  module: string;
  severity: string;
  title: string;
  impact: string;
};

type InventoryItem = {
  sku: string;
  name: string;
  category: string;
  warehouse: string;
  stock: number;
  monthlySales: number;
  status: string;
  margin: number;
  supplier: string;
  notes: string;
};

type Summary = {
  totalProducts: number;
  lowStock: unknown[];
  overstock: unknown[];
  slowMoving: unknown[];
  highMargin: unknown[];
  slowMovingValue: number;
  warehouses: string[];
};

type OpsChatSnapshot = {
  summary?: Summary;
  recommendations?: Recommendation[];
  executiveSignals?: ExecutiveSignal[];
  orchestrationTimeline?: OrchestrationStep[];
};

type InventorySnapshot = {
  inventory?: InventoryItem[];
  summary?: Summary;
  recommendations?: Recommendation[];
  salesOpportunities?: SalesOpportunity[];
  marketingCampaigns?: MarketingCampaign[];
  signals?: ExecutiveSignal[];
};

type SupportSnapshot = {
  tickets?: SupportTicket[];
  summary?: SupportSummary;
  signals?: ExecutiveSignal[];
};

type LogisticsSnapshot = {
  logistics?: LogisticsItem[];
  summary?: LogisticsSummary;
  signals?: ExecutiveSignal[];
};

type OpsBrainSnapshot = {
  actionTickets?: ActionTicket[];
  enterpriseMetrics?: EnterpriseMetric[];
};

type InventoryFilter = "all" | "low-stock" | "overstock" | "slow-moving" | "normal";
type LogisticsFilter = "all" | "high-risk" | "delayed" | "in-transit" | "arrived";

const scenarioResults: Record<string, ScenarioResult> = {
  shipmentDelay: {
    title: "Delay shipment by 14 days",
    expectedRisk: "High stockout risk for low-stock sofas, chairs and lighting.",
    recommendedAction:
      "Escalate supplier ETA, prepare substitute products, and alert sales/support teams.",
    estimatedBusinessImpact:
      "$85k-$120k revenue exposure if demand continues at current velocity.",
  },
  overstockDiscount: {
    title: "Apply 15% discount to overstock",
    expectedRisk: "Medium margin dilution, but lower inventory holding pressure.",
    recommendedAction:
      "Launch a controlled bundle campaign on overstock items with high-margin add-ons.",
    estimatedBusinessImpact:
      "Could release $90k+ tied capital while preserving basket margin.",
  },
  stockTransfer: {
    title: "Transfer stock from Melbourne to Sydney",
    expectedRisk: "Low operational risk if transfer is limited to available overstock.",
    recommendedAction:
      "Move selected fast-turning SKUs to Sydney and pause replenishment until sell-through improves.",
    estimatedBusinessImpact:
      "Improves availability in a high-demand store and reduces lost-sales pressure.",
  },
};

const collaborationSteps = [
  {
    agent: "System Coordinator",
    detail: "Detected query and selected relevant agents",
  },
  {
    agent: "Inventory Agent",
    detail: "Analysed stock pressure and sales velocity",
  },
  {
    agent: "Logistics Agent",
    detail: "Checked supplier and inbound shipment risks",
  },
  {
    agent: "Sales Agent",
    detail: "Generated substitution or bundle opportunities",
  },
  {
    agent: "Marketing Agent",
    detail: "Prepared campaign direction",
  },
  {
    agent: "Executive Orchestrator",
    detail: "Generated action tickets",
  },
];

const defaultOrchestrationTimeline = [
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

const modules = [
  "Executive",
  "Inventory",
  "Sales",
  "Marketing",
  "Support",
  "Logistics",
  "Business Case"
];

const inventoryFilterOptions: { label: string; value: InventoryFilter }[] = [
  { label: "All", value: "all" },
  { label: "Low Stock", value: "low-stock" },
  { label: "Overstock", value: "overstock" },
  { label: "Slow Moving", value: "slow-moving" },
  { label: "Normal", value: "normal" },
];

const logisticsFilterOptions: { label: string; value: LogisticsFilter }[] = [
  { label: "All", value: "all" },
  { label: "High Risk", value: "high-risk" },
  { label: "Delayed", value: "delayed" },
  { label: "In Transit", value: "in-transit" },
  { label: "Arrived", value: "arrived" },
];

const inventoryStatusRank: Record<string, number> = {
  "low-stock": 0,
  overstock: 1,
  "slow-moving": 2,
  normal: 3,
};

export default function OpsPage() {
  const [activeModule, setActiveModule] = useState("Executive");
  const [message, setMessage] = useState(
    "What are the top 3 operational risks today and what should management do?"
  );
  const [answer, setAnswer] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflow, setWorkflow] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [executiveSignals, setExecutiveSignals] = useState<ExecutiveSignal[]>([]);
  const [salesOpportunities, setSalesOpportunities] = useState<SalesOpportunity[]>([]);
  const [marketingCampaigns, setMarketingCampaigns] = useState<MarketingCampaign[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [supportSummary, setSupportSummary] = useState<SupportSummary | null>(null);
  const [logistics, setLogistics] = useState<LogisticsItem[]>([]);
  const [logisticsSummary, setLogisticsSummary] = useState<LogisticsSummary | null>(null);
  const [orchestrationTimeline, setOrchestrationTimeline] = useState<OrchestrationStep[]>([]);
  const [actionTickets, setActionTickets] = useState<ActionTicket[]>([]);
  const [enterpriseMetrics, setEnterpriseMetrics] = useState<EnterpriseMetric[]>([]);
  const [workflowActivityLog, setWorkflowActivityLog] = useState<WorkflowActivityEntry[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function fetchJson<T>(url: string): Promise<T> {
      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        const body = await response.text().catch(() => "");

        console.error(`Failed to fetch ${url}`, {
          status: response.status,
          statusText: response.statusText,
          body,
        });
        throw new Error(`${url} returned ${response.status}`);
      }

      return response.json();
    }

    async function loadData() {
      const [
        opsResult,
        inventoryResult,
        supportResult,
        logisticsResult,
        brainResult,
      ] = await Promise.allSettled([
        fetchJson<OpsChatSnapshot>("/api/ops-chat"),
        fetchJson<InventorySnapshot>("/api/inventory"),
        fetchJson<SupportSnapshot>("/api/support"),
        fetchJson<LogisticsSnapshot>("/api/logistics"),
        fetchJson<OpsBrainSnapshot>("/api/ops-brain"),
      ]);

      if (!isMounted) return;

      const inventorySnapshot =
        inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
      const supportSnapshot =
        supportResult.status === "fulfilled" ? supportResult.value : null;
      const logisticsSnapshot =
        logisticsResult.status === "fulfilled" ? logisticsResult.value : null;
      const fallbackExecutiveSignals = [
        ...(inventorySnapshot?.signals || []),
        ...(supportSnapshot?.signals || []),
        ...(logisticsSnapshot?.signals || []),
      ];

      if (opsResult.status === "fulfilled") {
        setSummary(opsResult.value.summary || inventorySnapshot?.summary || null);
        setRecommendations(
          opsResult.value.recommendations?.length
            ? opsResult.value.recommendations
            : inventorySnapshot?.recommendations || []
        );
        setExecutiveSignals(
          opsResult.value.executiveSignals?.length
            ? opsResult.value.executiveSignals
            : fallbackExecutiveSignals
        );
        setOrchestrationTimeline(
          opsResult.value.orchestrationTimeline?.length
            ? opsResult.value.orchestrationTimeline
            : defaultOrchestrationTimeline
        );
      } else {
        console.error("Failed to load /api/ops-chat", opsResult.reason);
        setSummary(inventorySnapshot?.summary || null);
        setRecommendations(inventorySnapshot?.recommendations || []);
        setExecutiveSignals(fallbackExecutiveSignals);
        setOrchestrationTimeline(defaultOrchestrationTimeline);
      }

      if (inventoryResult.status === "fulfilled") {
        setInventory(inventoryResult.value.inventory || []);
        setSalesOpportunities(inventoryResult.value.salesOpportunities || []);
        setMarketingCampaigns(inventoryResult.value.marketingCampaigns || []);
      } else {
        console.error("Failed to load /api/inventory", inventoryResult.reason);
      }

      if (supportResult.status === "fulfilled") {
        setSupportTickets(supportResult.value.tickets || []);
        setSupportSummary(supportResult.value.summary || null);
      } else {
        console.error("Failed to load /api/support", supportResult.reason);
      }

      if (logisticsResult.status === "fulfilled") {
        setLogistics(logisticsResult.value.logistics || []);
        setLogisticsSummary(logisticsResult.value.summary || null);
      } else {
        console.error("Failed to load /api/logistics", logisticsResult.reason);
      }

      if (brainResult.status === "fulfilled") {
        setActionTickets(brainResult.value.actionTickets || []);
        setEnterpriseMetrics(brainResult.value.enterpriseMetrics || []);
      } else {
        console.error("Failed to load /api/ops-brain", brainResult.reason);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  function updateActionTicketStatus(
    ticket: ActionTicket,
    status: TicketWorkflowStatus
  ) {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    setActionTickets((currentTickets) =>
      currentTickets.map((currentTicket) =>
        currentTicket.id === ticket.id
          ? { ...currentTicket, status }
          : currentTicket
      )
    );

    setWorkflowActivityLog((currentLog) => [
      {
        id: `${ticket.id}-${status}-${Date.now()}`,
        message: getWorkflowActivityMessage(ticket, status),
        timestamp,
      },
      ...currentLog,
    ]);
  }

  async function askOpsAgent(moduleName = activeModule) {
    setLoading(true);
    setAnswer("");
    setAgents([]);
    setWorkflow([]);

    try {
      const res = await fetch("/api/ops-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, module: moduleName }),
      });

      const data = await res.json();
      setAnswer(data.answer || "No answer returned.");
      setAgents(data.agents || []);
      setWorkflow(data.workflow || []);
    } catch {
      setAnswer("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl space-y-8">
        <Hero />

        <section className="flex flex-wrap gap-3">
          {modules.map((module) => (
            <button
              key={module}
              onClick={() => {
                setActiveModule(module);
                setAnswer("");
                setWorkflow([]);
              }}
              className={`rounded-full border px-5 py-2 text-sm transition ${
                activeModule === module
                  ? "border-amber-300 bg-amber-300 text-black"
                  : "border-white/10 bg-white/5 text-neutral-300 hover:border-amber-300"
              }`}
            >
              {module}
            </button>
          ))}
        </section>

        {activeModule === "Executive" && (
          <ExecutiveModule
            summary={summary}
            recommendations={recommendations}
            executiveSignals={executiveSignals}
            orchestrationTimeline={orchestrationTimeline}
            message={message}
            setMessage={setMessage}
            answer={answer}
            loading={loading}
            askOpsAgent={() => askOpsAgent("Executive")}
            agents={agents}
            workflow={workflow}
            actionTickets={actionTickets}
            enterpriseMetrics={enterpriseMetrics}
            workflowActivityLog={workflowActivityLog}
            onTicketAction={updateActionTicketStatus}
          />
        )}

        {activeModule === "Inventory" && (
          <InventoryModule inventory={inventory} recommendations={recommendations} />
        )}

        {activeModule === "Sales" && (
          <SalesModule salesOpportunities={salesOpportunities} />
        )}

        {activeModule === "Marketing" && (
          <MarketingModule marketingCampaigns={marketingCampaigns} />
        )}

        {activeModule === "Support" && (
          <SupportModule
            tickets={supportTickets}
            summary={supportSummary}
          />
        )}

        {activeModule === "Logistics" && (
          <LogisticsModule
            logistics={logistics}
            summary={logisticsSummary}
          />
        )}

        {activeModule === "Business Case" && <BusinessCaseModule />}

        <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5">
          <p className="text-sm text-amber-100">
            Demo note: this prototype uses simulated inventory data. In
            production, each workspace would connect securely to Koala&apos;s
            inventory, warehouse, sales, supplier, ecommerce and support systems.
          </p>
        </section>
      </div>
    </main>
  );
}

function Hero() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
        KoalaOps AI Prototype
      </p>

      <h1 className="mt-4 text-4xl font-semibold">
        AI Workflow Orchestration Layer
      </h1>

      <p className="mt-4 max-w-4xl text-neutral-300">
        A modular agentic AI system for retail operations. Each department gets
        its own AI workspace, while executives get a single orchestration layer
        across inventory, sales, marketing, support and logistics.
      </p>
    </section>
  );
}

function ExecutiveModule({
  summary,
  recommendations,
  executiveSignals,
  orchestrationTimeline,
  message,
  setMessage,
  answer,
  loading,
  askOpsAgent,
  agents,
  workflow,
  actionTickets,
  enterpriseMetrics,
  workflowActivityLog,
  onTicketAction,
}: {
  summary: Summary | null;
  recommendations: Recommendation[];
  executiveSignals: ExecutiveSignal[];
  orchestrationTimeline: OrchestrationStep[];
  message: string;
  setMessage: (v: string) => void;
  answer: string;
  loading: boolean;
  askOpsAgent: () => void;
  agents: Agent[];
  workflow: string[];
  actionTickets: ActionTicket[];
  enterpriseMetrics: EnterpriseMetric[];
  workflowActivityLog: WorkflowActivityEntry[];
  onTicketAction: (
    ticket: ActionTicket,
    status: TicketWorkflowStatus
  ) => void;
}) {
  const examples = [
    "What are the top 3 operational risks today and what should management do?",
    "What should we promote?",
    "Which products are low stock?",
    "Which products are overstocked?",
    "Show high margin products",
  ];
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(
    null
  );

  return (
    <>
      <ExecutiveCommandBar
        message={message}
        setMessage={setMessage}
        loading={loading}
        askOpsAgent={askOpsAgent}
        examples={[
          "Which stores have the highest operational pressure today?",
          "Where are we exposed to stockout and supplier delay risk?",
          "What should the national leadership team act on first?",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card title="Products Checked" value={String(summary?.totalProducts ?? "-")} detail="Live dataset" />
        <Card title="Low Stock" value={String(summary?.lowStock.length ?? "-")} detail="Stockout risk" />
        <Card title="Overstock" value={String(summary?.overstock.length ?? "-")} detail="Promotion opportunity" />
        <Card
          title="Slow Stock Value"
          value={summary ? `$${summary.slowMovingValue.toLocaleString()}` : "-"}
          detail="Estimated tied inventory"
        />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
              Enterprise Metrics
            </p>
            <h2 className="mt-2 text-xl font-medium">
              Retail Control Tower Indicators
            </h2>
          </div>
          <p className="text-sm text-neutral-400">
            Mock estimates from current inventory, sales velocity and margin.
          </p>
        </div>

        {enterpriseMetrics.length > 0 ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {enterpriseMetrics.map((metric) => (
              <EnterpriseMetricCard key={metric.id} metric={metric} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/30 p-5">
            <p className="text-sm text-neutral-400">
              Enterprise metrics will appear when the Ops Brain snapshot loads.
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <MiniChart title="Stock Risk" values={[4, 2, 1]} labels={["Low", "Over", "Slow"]} />
        <MiniChart title="Warehouse Coverage" values={[8, 6, 4, 3, 2]} labels={["MEL", "SYD", "BNE", "PER", "ADL"]} />
        <MiniChart title="Commercial Priority" values={[5, 4, 3]} labels={["Sales", "Margin", "Promo"]} />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-medium">Today&apos;s AI Executive Summary</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <SummaryLine text={`${summary?.lowStock.length ?? 0} stockout risks detected`} />
          <SummaryLine text={`${summary?.overstock.length ?? 0} overstock opportunities found`} />
          <SummaryLine text={`${summary?.slowMoving.length ?? 0} slow-moving product groups detected`} />
          <SummaryLine text={`${summary?.warehouses.length ?? 0} warehouse/store locations monitored`} />
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-medium">Cross-Department Signals</h2>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {executiveSignals.map((signal, index) => (
            <div
              key={`${signal.title}-${index}`}
              className="rounded-2xl border border-white/10 bg-black/40 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-amber-200">
                  {signal.module}
                </p>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300">
                  {signal.severity}
                </span>
              </div>

              <p className="mt-3 text-sm text-white">{signal.title}</p>
              <p className="mt-2 text-sm text-neutral-400">{signal.impact}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-medium">AI Orchestration Timeline</h2>

        <div className="mt-5 space-y-4">
          {orchestrationTimeline.map((item, index) => (
            <div
              key={`${item.step}-${index}`}
              className="relative rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-300 text-sm font-semibold text-black">
                  {index + 1}
                </div>

                <div>
                  <p className="text-sm font-medium text-emerald-100">
                    {item.step}
                  </p>
                  <p className="mt-1 text-sm text-neutral-300">
                    {item.detail}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <AgentCollaborationBoard
        agents={agents}
        workflow={workflow}
        loading={loading}
      />
      <ScenarioPanel
        scenarioResult={scenarioResult}
        onRunScenario={setScenarioResult}
      />
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-medium">AI Action Tickets</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
          Executive actions simulate how AI recommendations would be routed to
          department managers in production.
        </p>

        {actionTickets.length > 0 ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {actionTickets.map((ticket) => (
              <ActionTicketCard
                key={ticket.id}
                ticket={ticket}
                onTicketAction={onTicketAction}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/30 p-5">
            <p className="text-sm font-medium text-neutral-200">
              No AI action tickets found.
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-400">
              The Executive module is connected to the Ops Brain snapshot, but
              no cross-department risks were scored high enough to generate
              tickets. Check inventory, support and logistics signals or refresh
              after new operational data is loaded.
            </p>
          </div>
        )}
      </section>
      <WorkflowActivityLog entries={workflowActivityLog} />
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-medium">Ask Executive Orchestrator</h2>

          <textarea
            className="mt-4 h-28 w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-white outline-none focus:border-amber-300"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                onClick={() => setMessage(example)}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:border-amber-300 hover:text-white"
              >
                {example}
              </button>
            ))}
          </div>

          <button
            onClick={askOpsAgent}
            disabled={loading}
            className="mt-6 rounded-2xl bg-amber-300 px-6 py-3 font-medium text-black disabled:opacity-50"
          >
            {loading ? "Agents working..." : "Run AI Workflow"}
          </button>

          {answer && (
            <pre className="mt-6 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/50 p-5 text-sm leading-6 text-neutral-100">
              {answer}
            </pre>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Agent Activity">
            {(agents.length
              ? agents
              : [
                  { name: "Inventory Agent", status: "waiting for task" },
                  { name: "Warehouse Agent", status: "waiting for task" },
                  { name: "Commercial Agent", status: "waiting for task" },
                ]
            ).map((agent) => (
              <div key={agent.name} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <p className="font-medium text-amber-200">{agent.name}</p>
                <p className="mt-1 text-sm text-neutral-300">{agent.status}</p>
              </div>
            ))}
          </Panel>

          <Panel title="AI Workflow Execution">
            {(workflow.length ? workflow : ["Waiting for workflow execution..."]).map((step, index) => (
              <div key={index} className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                <p className="text-sm text-emerald-100">✓ {step}</p>
              </div>
            ))}
          </Panel>

          <Panel title="Recommended Actions">
            {recommendations.slice(0, 5).map((rec, index) => (
              <div key={`${rec.title}-${index}`} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="text-sm font-medium text-amber-200">{rec.type}</p>
                <p className="mt-1 text-sm text-white">{rec.title}</p>
                <p className="mt-2 text-sm text-neutral-300">{rec.action}</p>
              </div>
            ))}
          </Panel>
        </div>
      </section>
    </>
  );
}

function ExecutiveCommandBar({
  message,
  setMessage,
  loading,
  askOpsAgent,
  examples,
}: {
  message: string;
  setMessage: (value: string) => void;
  loading: boolean;
  askOpsAgent: () => void;
  examples: string[];
}) {
  return (
    <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-6 shadow-2xl">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
        Ask anything about our national footprint
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <textarea
          className="min-h-24 rounded-2xl border border-amber-300/20 bg-black/40 p-4 text-white outline-none placeholder:text-neutral-500 focus:border-amber-300"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask about stock risk, warehouse pressure, sales opportunities, customer issues or supplier delays..."
        />

        <button
          type="button"
          onClick={askOpsAgent}
          disabled={loading}
          className="rounded-2xl bg-amber-300 px-6 py-3 font-medium text-black disabled:opacity-50 lg:min-w-44"
        >
          {loading ? "Running..." : "Run AI Workflow"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setMessage(example)}
            className="rounded-full border border-amber-300/20 bg-black/20 px-4 py-2 text-sm text-amber-100 hover:border-amber-300"
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );
}

function EnterpriseMetricCard({ metric }: { metric: EnterpriseMetric }) {
  return (
    <div className="rounded-2xl border border-amber-300/20 bg-black/30 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
        {metric.label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-amber-100">
        {metric.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-neutral-400">{metric.detail}</p>
    </div>
  );
}

function AgentCollaborationBoard({
  agents,
  workflow,
  loading,
}: {
  agents: Agent[];
  workflow: string[];
  loading: boolean;
}) {
  const hasRun = workflow.length > 0 || agents.length > 0;
  const activeAgentNames = agents.map((agent) => agent.name);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
            Agent Collaboration Board
          </p>
          <h2 className="mt-2 text-xl font-medium">
            Multi-agent workflow coordination
          </h2>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
          {loading ? "Agents collaborating" : hasRun ? "Workflow complete" : "Ready"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-6">
        {collaborationSteps.map((step, index) => {
          const matchingWorkflow = workflow.find((item) =>
            item.startsWith(`${step.agent}:`)
          );
          const isActive =
            loading &&
            (activeAgentNames.includes(step.agent) ||
              (index === 0 && activeAgentNames.length === 0));
          const status = hasRun ? "completed" : isActive ? "working" : "standby";

          return (
            <div
              key={step.agent}
              className={`relative rounded-2xl border p-4 transition ${
                status === "completed"
                  ? "border-emerald-300/30 bg-emerald-300/10"
                  : status === "working"
                    ? "border-amber-300/40 bg-amber-300/10"
                    : "border-white/10 bg-black/30"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-black">
                  {index + 1}
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-300">
                  {status}
                </span>
              </div>

              <p className="mt-4 text-sm font-medium text-white">
                {step.agent}
              </p>
              <p className="mt-2 text-xs leading-5 text-neutral-400">
                {matchingWorkflow
                  ? matchingWorkflow.replace(`${step.agent}: `, "")
                  : step.detail}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScenarioPanel({
  scenarioResult,
  onRunScenario,
}: {
  scenarioResult: ScenarioResult | null;
  onRunScenario: (result: ScenarioResult) => void;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
            What-if Scenario Panel
          </p>
          <h2 className="mt-2 text-xl font-medium">
            Simulate operational decisions
          </h2>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <ScenarioButton
          label="Delay shipment by 14 days"
          onClick={() => onRunScenario(scenarioResults.shipmentDelay)}
        />
        <ScenarioButton
          label="Apply 15% discount to overstock"
          onClick={() => onRunScenario(scenarioResults.overstockDiscount)}
        />
        <ScenarioButton
          label="Transfer stock from Melbourne to Sydney"
          onClick={() => onRunScenario(scenarioResults.stockTransfer)}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-amber-300/20 bg-black/30 p-5">
        {scenarioResult ? (
          <>
            <p className="text-sm font-medium text-amber-100">
              {scenarioResult.title}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ScenarioDetail
                label="Expected risk"
                value={scenarioResult.expectedRisk}
              />
              <ScenarioDetail
                label="Recommended action"
                value={scenarioResult.recommendedAction}
              />
              <ScenarioDetail
                label="Estimated business impact"
                value={scenarioResult.estimatedBusinessImpact}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-400">
            Select a scenario to model expected risk, recommended action and
            estimated business impact.
          </p>
        )}
      </div>
    </section>
  );
}

function ScenarioButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-left text-sm font-medium text-neutral-200 transition hover:border-amber-300/60 hover:bg-amber-300/10 hover:text-white"
    >
      {label}
    </button>
  );
}

function ScenarioDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-neutral-200">{value}</p>
    </div>
  );
}

function DepartmentAssistantPanel({
  moduleName,
  title,
  examples,
}: {
  moduleName: string;
  title: string;
  examples: string[];
}) {
  const [message, setMessage] = useState(examples[0] || "");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function askDepartmentAgent() {
    if (!message.trim()) return;

    setLoading(true);
    setAnswer("");

    try {
      const response = await fetch("/api/ops-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, module: moduleName }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAnswer(
          typeof data.error === "string"
            ? data.error
            : `${moduleName} agent failed.`
        );
        return;
      }

      setAnswer(
        typeof data.answer === "string" ? data.answer : "No answer returned."
      );
    } catch {
      setAnswer(`${moduleName} agent could not connect.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
            Department AI Assistant
          </p>
          <h3 className="mt-2 text-xl font-medium">{title}</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-neutral-300">
          {moduleName}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <textarea
          className="min-h-24 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-amber-300"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Ask the ${moduleName} agent...`}
        />

        <button
          type="button"
          onClick={askDepartmentAgent}
          disabled={loading || !message.trim()}
          className="rounded-2xl bg-amber-300 px-6 py-3 text-sm font-medium text-black disabled:opacity-50 lg:min-w-36"
        >
          {loading ? "Thinking..." : "Ask Agent"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setMessage(example)}
            className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-neutral-300 hover:border-amber-300 hover:text-white"
          >
            {example}
          </button>
        ))}
      </div>

      {answer && (
        <pre className="mt-5 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/50 p-5 text-sm leading-6 text-neutral-100">
          {answer}
        </pre>
      )}
    </section>
  );
}

function getWorkflowActivityMessage(
  ticket: ActionTicket,
  status: TicketWorkflowStatus
) {
  if (status === "approved") {
    return `${ticket.id} approved by Executive Orchestrator`;
  }

  if (status === "escalated") {
    return `${ticket.id} escalated to ${ticket.owner}`;
  }

  return `${ticket.id} assigned to ${ticket.owner}`;
}

function getTicketStatusClass(status: string) {
  if (status === "approved") {
    return "border-emerald-300/40 bg-emerald-300/15 text-emerald-100";
  }

  if (status === "escalated") {
    return "border-red-300/40 bg-red-300/15 text-red-100";
  }

  if (status === "assigned") {
    return "border-sky-300/40 bg-sky-300/15 text-sky-100";
  }

  return "border-white/10 bg-black/30 text-neutral-200";
}

function ActionTicketCard({
  ticket,
  onTicketAction,
}: {
  ticket: ActionTicket;
  onTicketAction: (
    ticket: ActionTicket,
    status: TicketWorkflowStatus
  ) => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-amber-100">{ticket.id}</p>
        <span
          className={`rounded-full border px-3 py-1 text-xs capitalize ${getTicketStatusClass(
            ticket.status
          )}`}
        >
          {ticket.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <TicketMeta label="Owner" value={ticket.owner} />
        <TicketMeta label="Priority" value={ticket.priority} />
        <TicketMeta label="Score" value={String(ticket.score)} />
      </div>

      <TicketDetail label="Task" value={ticket.task} />
      <TicketDetail label="Reason" value={ticket.reason} />
      <TicketDetail label="Handoff" value={ticket.handoff} />

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <TicketActionButton
          label="Approve Recommendation"
          onClick={() => onTicketAction(ticket, "approved")}
        />
        <TicketActionButton
          label="Escalate Priority"
          onClick={() => onTicketAction(ticket, "escalated")}
        />
        <TicketActionButton
          label="Assign Owner"
          onClick={() => onTicketAction(ticket, "assigned")}
        />
      </div>
    </div>
  );
}

function TicketActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-medium text-neutral-200 transition hover:border-amber-300/60 hover:bg-amber-300/10 hover:text-white"
    >
      {label}
    </button>
  );
}

function WorkflowActivityLog({
  entries,
}: {
  entries: WorkflowActivityEntry[];
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-medium">Workflow Activity Log</h2>

      {entries.length > 0 ? (
        <div className="mt-4 space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4"
            >
              <p className="text-sm text-emerald-100">{entry.message}</p>
              <span className="text-xs text-neutral-400">{entry.timestamp}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/30 p-5">
          <p className="text-sm text-neutral-400">
            No workflow actions taken yet.
          </p>
        </div>
      )}
    </section>
  );
}

function TicketMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function TicketDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-neutral-200">{value}</p>
    </div>
  );
}

function BusinessCaseModule() {
  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Executive Business Case
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          AI Workflow Orchestration Layer for Koala Living
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A practical AI control layer for multi-store retail operations. It
          sits above existing systems, detects operational risk, coordinates
          specialist agents and turns disconnected signals into accountable
          action tickets for the right teams.
        </p>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Problem">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>
              Koala operates across stores, a DC, imported supplier stock,
              ecommerce demand, support tickets and delivery constraints.
            </p>
            <p>
              The operational challenge is not a lack of data. It is manual
              coordination across disconnected systems, especially when imported
              stock is delayed, stores run low, or customers need clear answers.
            </p>
          </div>
        </Panel>

        <Panel title="Solution">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>
              Build an AI workflow orchestration layer on top of existing
              inventory, warehouse, sales, support and logistics tools.
            </p>
            <p>
              Specialist agents monitor each function while the Executive
              Orchestrator ranks risk, explains evidence and creates action
              tickets with owners, handoffs and recommended next steps.
            </p>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <BusinessCard
          title="Pilot Scope"
          detail="Start with inventory and warehouse coordination: low-stock alerts, overstock actions, inbound shipment risk and store transfer recommendations."
        />

        <BusinessCard
          title="Future Expansion"
          detail="Extend into sales substitutions, marketing campaigns, support escalations and logistics delay management once the first workflow proves value."
        />

        <BusinessCard
          title="Commercial Model"
          detail="Paid setup and integration fee, followed by monthly support and platform fee for monitoring, workflow tuning and new agent modules."
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Why This Is Different">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>
              Generic AI chatbots answer prompts. This prototype acts like an
              operating layer: it watches signals, scores priority, assigns
              responsibility and records workflow activity.
            </p>
            <p>
              It is tailored around furniture retail realities: imported lead
              times, bulky inventory, store transfers, floor stock, customer
              delivery expectations and bundle-led merchandising.
            </p>
          </div>
        </Panel>

        <Panel title="Pilot Success Metrics">
          <div className="space-y-3 text-sm text-neutral-300">
            <p>• Reduce time spent manually checking inventory issues</p>
            <p>• Detect low-stock and overstock risks earlier</p>
            <p>• Improve coordination between warehouse, sales and support</p>
            <p>• Generate faster commercial actions from operational data</p>
            <p>• Build reusable workflow modules for future rollout</p>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Panel title="ROI / Impact Estimate">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>• Reduce manual coordination time by 20-30%</p>
            <p>• Detect stockout and supplier risks earlier</p>
            <p>
              • Improve response speed across warehouse, sales and support
            </p>
          </div>
        </Panel>

        <Panel title="Security & Governance">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>• Role-based access by department and responsibility</p>
            <p>• Audit log for recommendations, approvals and handoffs</p>
            <p>• Human approval workflow before commercial action</p>
            <p>• Secure API integration with existing operating systems</p>
            <p>• No autonomous purchasing without management approval</p>
          </div>
        </Panel>

        <Panel title="Phased Rollout Roadmap">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>Phase 1: Inventory + warehouse pilot</p>
            <p>Phase 2: Sales + support workflows</p>
            <p>Phase 3: Marketing + logistics orchestration</p>
            <p>Phase 4: Predictive executive control tower</p>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Strategic Opportunity">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>
              Koala can become the pilot customer for a retail-specific AI
              workflow platform shaped around its real operating model.
            </p>
            <p>
              If the pilot proves measurable value, Koala could become a future
              strategic partner, investor or reference customer as the platform
              expands to other furniture and home retailers.
            </p>
          </div>
        </Panel>

        <Panel title="Executive Decision">
          <div className="space-y-3 text-sm leading-6 text-neutral-300">
            <p>
              Approve a focused discovery and paid pilot around inventory and
              warehouse coordination, not a broad transformation program.
            </p>
            <p>
              The goal is to prove faster decisions, fewer stock surprises and
              clearer department handoffs before connecting deeper systems.
            </p>
          </div>
        </Panel>
      </section>

      <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-6">
        <h3 className="text-xl font-medium text-amber-100">
          Proposed Next Step
        </h3>

        <p className="mt-3 max-w-4xl text-sm leading-6 text-amber-100">
          Run a 4-6 week pilot using selected inventory, warehouse and inbound
          shipment data. Deliver a working executive control tower, action
          tickets, team handoffs and a measurable before/after operating report.
        </p>
      </section>
    </section>
  );
}

function BusinessCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h3 className="text-lg font-medium text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-neutral-300">{detail}</p>
    </div>
  );
}

function createActivityEntry(message: string): WorkflowActivityEntry {
  return {
    id: `${message}-${Date.now()}`,
    message,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ");
}

function getInventoryStatusClass(status: string) {
  if (status === "low-stock") {
    return "border-red-300/40 bg-red-300/15 text-red-100";
  }

  if (status === "overstock") {
    return "border-amber-300/40 bg-amber-300/15 text-amber-100";
  }

  if (status === "slow-moving") {
    return "border-orange-300/40 bg-orange-300/15 text-orange-100";
  }

  return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
}

function getSupportSla(ticket: SupportTicket) {
  if (ticket.priority === "high" || ticket.sentiment === "negative") {
    return {
      label: "Urgent",
      className: "border-red-300/40 bg-red-300/15 text-red-100",
    };
  }

  if (ticket.priority === "medium" || ticket.status === "open") {
    return {
      label: "Due today",
      className: "border-amber-300/40 bg-amber-300/15 text-amber-100",
    };
  }

  return {
    label: "Monitor",
    className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  };
}

function getLogisticsRiskClass(risk: string) {
  if (risk === "high") {
    return "border-red-300/40 bg-red-300/15 text-red-100";
  }

  if (risk === "medium") {
    return "border-amber-300/40 bg-amber-300/15 text-amber-100";
  }

  return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
}

function getLogisticsStatusClass(status: string) {
  if (status === "delayed") {
    return "border-red-300/40 bg-red-300/15 text-red-100";
  }

  if (status === "in-transit") {
    return "border-sky-300/40 bg-sky-300/15 text-sky-100";
  }

  if (status === "arrived") {
    return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  }

  return "border-amber-300/40 bg-amber-300/15 text-amber-100";
}

function matchesLogisticsFilter(item: LogisticsItem, filter: LogisticsFilter) {
  if (filter === "all") return true;
  if (filter === "high-risk") return item.risk === "high";
  return item.status === filter;
}

function getSupplierScore(item: LogisticsItem) {
  const baseScore =
    item.risk === "high" ? 64 : item.risk === "medium" ? 78 : 91;
  const statusPenalty = item.status === "delayed" ? 8 : item.status === "pending" ? 4 : 0;

  return Math.max(50, baseScore - statusPenalty);
}

function getDelayImpact(item: LogisticsItem) {
  if (item.risk === "high") {
    return "Potential revenue risk if store teams keep selling without substitute guidance.";
  }

  if (item.status === "delayed") {
    return "Watch ETA closely and prepare customer communication before demand spikes.";
  }

  return "Manageable impact if ETA remains stable and store teams monitor availability.";
}

function getSalesEstimatedImpact(item: SalesOpportunity, index: number) {
  const multiplier = index + 1;

  if (item.type === "Bundle Opportunity") {
    return `Estimated stock reduction: ${10 + multiplier * 3} units`;
  }

  if (item.type === "High Margin Push") {
    return `Estimated margin uplift: $${(4500 + multiplier * 1250).toLocaleString()}`;
  }

  return `Estimated revenue recovery: $${(8500 + multiplier * 1500).toLocaleString()}`;
}

function getCampaignProjection(campaign: MarketingCampaign, index: number) {
  const revenue =
    campaign.campaignType === "Premium Product Push"
      ? 22000 + index * 2500
      : 14000 + index * 1800;
  const stockReduction =
    campaign.campaignType === "Bundle Campaign" ? 18 + index * 2 : 8 + index;
  const suggestedChannel = campaign.channel.split(",")[0] || campaign.channel;

  return {
    revenue: `$${revenue.toLocaleString()}`,
    stockReduction: `${stockReduction} units`,
    suggestedChannel,
  };
}

function ActivityActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-medium text-neutral-200 transition hover:border-amber-300/60 hover:bg-amber-300/10 hover:text-white"
    >
      {label}
    </button>
  );
}

function LocalActivityLog({
  entries,
  emptyText,
}: {
  entries: WorkflowActivityEntry[];
  emptyText: string;
}) {
  return entries.length > 0 ? (
    <div className="space-y-2">
      {entries.slice(0, 5).map((entry) => (
        <div
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3"
        >
          <p className="text-xs text-emerald-100">{entry.message}</p>
          <span className="text-[11px] text-neutral-400">
            {entry.timestamp}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-4">
      <p className="text-sm text-neutral-400">{emptyText}</p>
    </div>
  );
}

function LogisticsModule({
  logistics,
  summary,
}: {
  logistics: LogisticsItem[];
  summary: LogisticsSummary | null;
}) {
  const [logisticsFilter, setLogisticsFilter] = useState<LogisticsFilter>("all");
  const [showAllLogistics, setShowAllLogistics] = useState(false);
  const [logisticsActivityLog, setLogisticsActivityLog] = useState<
    WorkflowActivityEntry[]
  >([]);
  const filteredLogistics = logistics
    .filter((item) => matchesLogisticsFilter(item, logisticsFilter))
    .sort((a, b) => {
      const riskRank = { high: 0, medium: 1, low: 2 };
      const statusRank = { delayed: 0, pending: 1, "in-transit": 2, arrived: 3 };
      const riskDelta =
        (riskRank[a.risk as keyof typeof riskRank] ?? 3) -
        (riskRank[b.risk as keyof typeof riskRank] ?? 3);

      if (riskDelta !== 0) return riskDelta;

      return (
        (statusRank[a.status as keyof typeof statusRank] ?? 4) -
        (statusRank[b.status as keyof typeof statusRank] ?? 4)
      );
    });
  const visibleLogistics = showAllLogistics
    ? filteredLogistics
    : filteredLogistics.slice(0, 8);

  function recordLogisticsAction(action: string, item: LogisticsItem) {
    setLogisticsActivityLog((currentLog) => [
      createActivityEntry(`${action}: ${item.id} · ${item.product}`),
      ...currentLog,
    ]);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Logistics AI Workspace
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          Supplier, Shipment & Replenishment Intelligence
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A specialist AI workspace for operations and logistics teams. It
          monitors supplier delays, inbound shipments, warehouse replenishment,
          customer delivery risk and cross-department impact.
        </p>
      </div>

      <DepartmentAssistantPanel
        moduleName="Logistics"
        title="Ask Logistics Agent"
        examples={[
          "Which shipments are most likely to affect replenishment?",
          "Which supplier delays need escalation today?",
          "What ETAs should support communicate to customers?",
          "Where should we prepare substitute product guidance?",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card
          title="Shipments Checked"
          value={String(summary?.totalShipments ?? "-")}
          detail="Inbound movement"
        />
        <Card
          title="Delayed"
          value={String(summary?.delayed.length ?? "-")}
          detail="Needs attention"
        />
        <Card
          title="High Risk"
          value={String(summary?.highRisk.length ?? "-")}
          detail="Stock impact"
        />
        <Card
          title="In Transit"
          value={String(summary?.inTransit.length ?? "-")}
          detail="Expected arrivals"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-xl font-medium">
                Shipment Risk Intelligence
              </h3>
              <p className="mt-1 text-sm text-neutral-400">
                Filter by ETA risk, shipment status and supplier pressure.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {logisticsFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setLogisticsFilter(option.value);
                    setShowAllLogistics(false);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    logisticsFilter === option.value
                      ? "border-amber-300 bg-amber-300 text-black"
                      : "border-white/10 bg-black/30 text-neutral-300 hover:border-amber-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleLogistics.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-black/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-white">{item.id}</p>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${getLogisticsRiskClass(
                        item.risk
                      )}`}
                    >
                      {item.risk} risk
                    </span>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${getLogisticsStatusClass(
                        item.status
                      )}`}
                    >
                      {formatStatusLabel(item.status)}
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-sm text-neutral-300">
                  Product: {item.product}
                </p>

                <p className="mt-2 text-sm text-neutral-300">
                  Route: {item.origin} → {item.destination}
                </p>

                <p className="mt-2 text-sm text-neutral-300">
                  Status: {item.status} · ETA: {item.eta}
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                      Supplier score
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {getSupplierScore(item)} / 100
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                      Delay impact
                    </p>
                    <p className="mt-1 text-xs leading-5 text-neutral-300">
                      {getDelayImpact(item)}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-sm text-neutral-300">
                  Reason: {item.reason}
                </p>

                <p className="mt-2 text-sm text-emerald-200">
                  Recommended action: {item.recommendedAction}
                </p>

                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  <ActivityActionButton
                    label="Escalate Supplier"
                    onClick={() => recordLogisticsAction("Escalated supplier", item)}
                  />
                  <ActivityActionButton
                    label="Notify Support"
                    onClick={() => recordLogisticsAction("Notified support", item)}
                  />
                  <ActivityActionButton
                    label="Pause Promotion"
                    onClick={() => recordLogisticsAction("Paused promotion", item)}
                  />
                  <ActivityActionButton
                    label="Update ETA"
                    onClick={() => recordLogisticsAction("Updated ETA", item)}
                  />
                </div>
              </div>
            ))}
          </div>

          {filteredLogistics.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAllLogistics((current) => !current)}
              className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:border-amber-300 hover:text-white"
            >
              {showAllLogistics
                ? "Show fewer shipments"
                : `Show all ${filteredLogistics.length} shipments`}
            </button>
          )}
        </div>

        <Panel title="Logistics Agent Workflow">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-medium text-white">
              Logistics Activity Log
            </p>
            <div className="mt-3">
              <LocalActivityLog
                entries={logisticsActivityLog}
                emptyText="No logistics workflow actions taken yet."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Supplier Agent checks China manufacturing and dispatch risk
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Shipping Agent monitors container and ETA delay
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Inventory Agent checks whether delay creates stockout risk
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Support and Sales teams receive availability guidance
            </p>
          </div>
        </Panel>
      </section>
    </section>
  );
}

function SupportModule({
  tickets,
  summary,
}: {
  tickets: SupportTicket[];
  summary: SupportSummary | null;
}) {
  const [showAllTickets, setShowAllTickets] = useState(false);
  const [supportActivityLog, setSupportActivityLog] = useState<
    WorkflowActivityEntry[]
  >([]);
  const sortedTickets = [...tickets].sort((a, b) => {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const sentimentRank = { negative: 0, neutral: 1, positive: 2 };
    const priorityDelta =
      (priorityRank[a.priority as keyof typeof priorityRank] ?? 3) -
      (priorityRank[b.priority as keyof typeof priorityRank] ?? 3);

    if (priorityDelta !== 0) return priorityDelta;

    return (
      (sentimentRank[a.sentiment as keyof typeof sentimentRank] ?? 3) -
      (sentimentRank[b.sentiment as keyof typeof sentimentRank] ?? 3)
    );
  });
  const visibleTickets = showAllTickets
    ? sortedTickets
    : sortedTickets.slice(0, 8);

  function recordSupportAction(action: string, ticket: SupportTicket) {
    setSupportActivityLog((currentLog) => [
      createActivityEntry(`${action}: ${ticket.id} · ${ticket.product}`),
      ...currentLog,
    ]);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Customer Support AI Workspace
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          Ticket, Complaint & Escalation Intelligence
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A specialist AI workspace for support teams. It classifies customer
          tickets, detects complaint trends, recommends replies and escalates
          high-risk issues to the right operational team.
        </p>
      </div>

      <DepartmentAssistantPanel
        moduleName="Support"
        title="Ask Support Agent"
        examples={[
          "Which tickets need escalation today?",
          "What customer communication should we send about delayed deliveries?",
          "Which issues are linked to stock availability?",
          "Summarise negative sentiment and recommended follow-ups.",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card
          title="Tickets Checked"
          value={String(summary?.totalTickets ?? "-")}
          detail="Support dataset"
        />
        <Card
          title="Open Tickets"
          value={String(summary?.openTickets.length ?? "-")}
          detail="Need action"
        />
        <Card
          title="High Priority"
          value={String(summary?.highPriority.length ?? "-")}
          detail="Escalation risk"
        />
        <Card
          title="Negative Sentiment"
          value={String(summary?.negativeSentiment.length ?? "-")}
          detail="Customer experience risk"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-xl font-medium">
                Support Ticket Intelligence
              </h3>
              <p className="mt-1 text-sm text-neutral-400">
                Highest priority and negative-sentiment tickets appear first.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleTickets.map((ticket) => {
              const sla = getSupportSla(ticket);

              return (
                <div
                  key={ticket.id}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-white">{ticket.id}</p>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs ${sla.className}`}
                      >
                        {sla.label}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs capitalize text-neutral-300">
                        {ticket.priority}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-neutral-300">
                    Customer: {ticket.customer} · {ticket.category}
                  </p>

                  <p className="mt-2 text-sm text-neutral-300">
                    Product: {ticket.product}
                  </p>

                  <p className="mt-2 text-sm text-neutral-300">
                    Issue: {ticket.summary}
                  </p>

                  <p className="mt-2 text-sm text-emerald-200">
                    Recommended action: {ticket.recommendedAction}
                  </p>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <ActivityActionButton
                      label="Escalate to Logistics"
                      onClick={() =>
                        recordSupportAction("Escalated to logistics", ticket)
                      }
                    />
                    <ActivityActionButton
                      label="Reserve Replacement Stock"
                      onClick={() =>
                        recordSupportAction("Reserved replacement stock", ticket)
                      }
                    />
                    <ActivityActionButton
                      label="Send Customer Update"
                      onClick={() =>
                        recordSupportAction("Sent customer update", ticket)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {sortedTickets.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAllTickets((current) => !current)}
              className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:border-amber-300 hover:text-white"
            >
              {showAllTickets
                ? "Show fewer tickets"
                : `Show all ${sortedTickets.length} tickets`}
            </button>
          )}
        </div>

        <Panel title="Support Agent Workflow">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-medium text-white">
              Support Activity Log
            </p>
            <div className="mt-3">
              <LocalActivityLog
                entries={supportActivityLog}
                emptyText="No support workflow actions taken yet."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Support Agent classifies ticket category and sentiment
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Inventory Agent checks product availability
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Logistics Agent checks delivery risk
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Executive layer receives customer risk signal
            </p>
          </div>
        </Panel>
      </section>
    </section>
  );
}

function MarketingModule({
  marketingCampaigns,
}: {
  marketingCampaigns: MarketingCampaign[];
}) {
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [marketingActivityLog, setMarketingActivityLog] = useState<
    WorkflowActivityEntry[]
  >([]);
  const bundleCampaigns = marketingCampaigns.filter(
    (item) => item.campaignType === "Bundle Campaign"
  ).length;

  const premiumCampaigns = marketingCampaigns.filter(
    (item) => item.campaignType === "Premium Product Push"
  ).length;
  const visibleCampaigns = showAllCampaigns
    ? marketingCampaigns
    : marketingCampaigns.slice(0, 6);

  function recordMarketingAction(action: string, campaign: MarketingCampaign) {
    setMarketingActivityLog((currentLog) => [
      createActivityEntry(`${action}: ${campaign.title}`),
      ...currentLog,
    ]);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Marketing AI Workspace
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          Campaign & Promotion Intelligence
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A specialist AI workspace for marketing teams. It converts inventory
          pressure and sales opportunities into campaign ideas, audience
          targeting, promotion messages and channel recommendations.
        </p>
      </div>

      <DepartmentAssistantPanel
        moduleName="Marketing"
        title="Ask Marketing Agent"
        examples={[
          "What campaigns should we run for overstock?",
          "Which products should be promoted as premium hero items?",
          "Create a bundle campaign for slow-moving stock.",
          "Which audience and channels fit the current sales signals?",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card
          title="Campaign Ideas"
          value={String(marketingCampaigns.length)}
          detail="Generated from sales signals"
        />
        <Card
          title="Bundle Campaigns"
          value={String(bundleCampaigns)}
          detail="Move excess stock"
        />
        <Card
          title="Premium Push"
          value={String(premiumCampaigns)}
          detail="High margin products"
        />
        <Card
          title="Channels"
          value="4"
          detail="Email, social, web, showroom"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="AI Campaign Recommendations">
          {visibleCampaigns.map((campaign, index) => {
            const projection = getCampaignProjection(campaign, index);

            return (
              <div
                key={`${campaign.title}-${index}`}
                className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4"
              >
                <p className="text-sm font-medium text-amber-200">
                  {campaign.campaignType}
                </p>
                <p className="mt-1 text-sm text-white">{campaign.title}</p>
                <p className="mt-2 text-sm text-neutral-300">
                  Signal: {campaign.sourceSignal}
                </p>
                <p className="mt-2 text-sm text-neutral-300">
                  Audience: {campaign.targetAudience}
                </p>
                <p className="mt-2 text-sm text-neutral-300">
                  Channel: {campaign.channel}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <TicketMeta
                    label="Revenue"
                    value={projection.revenue}
                  />
                  <TicketMeta
                    label="Stock reduction"
                    value={projection.stockReduction}
                  />
                  <TicketMeta
                    label="Suggested channel"
                    value={projection.suggestedChannel}
                  />
                </div>
                <p className="mt-2 text-sm text-emerald-200">
                  Message: {campaign.message}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <ActivityActionButton
                    label="Generate Campaign Brief"
                    onClick={() =>
                      recordMarketingAction("Generated campaign brief", campaign)
                    }
                  />
                  <ActivityActionButton
                    label="Send to Email Team"
                    onClick={() =>
                      recordMarketingAction("Sent to email team", campaign)
                    }
                  />
                  <ActivityActionButton
                    label="Assign to Region"
                    onClick={() =>
                      recordMarketingAction("Assigned to region", campaign)
                    }
                  />
                </div>
              </div>
            );
          })}

          {marketingCampaigns.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllCampaigns((current) => !current)}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:border-amber-300 hover:text-white"
            >
              {showAllCampaigns
                ? "Show fewer campaigns"
                : `Show all ${marketingCampaigns.length} campaigns`}
            </button>
          )}
        </Panel>

        <Panel title="Cross-Agent Flow">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-medium text-white">
              Campaign Activity Log
            </p>
            <div className="mt-3">
              <LocalActivityLog
                entries={marketingActivityLog}
                emptyText="No campaign workflow actions taken yet."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Inventory Agent identifies excess stock
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Sales Agent turns it into bundle opportunity
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Marketing Agent creates campaign direction
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Executive layer tracks commercial impact
            </p>
          </div>
        </Panel>
      </section>
    </section>
  );
}

function SalesModule({
  salesOpportunities,
}: {
  salesOpportunities: SalesOpportunity[];
}) {
  const [salesActivityLog, setSalesActivityLog] = useState<
    WorkflowActivityEntry[]
  >([]);
  const bundleOpportunities = salesOpportunities.filter(
    (item) => item.type === "Bundle Opportunity"
  );

  const highMarginOpportunities = salesOpportunities.filter(
    (item) => item.type === "High Margin Push"
  );

  const substitutionRisks = salesOpportunities.filter(
    (item) => item.type === "Substitution Risk"
  );
  const opportunityGroups = [
    {
      title: "Bundle Opportunities",
      items: bundleOpportunities,
      emptyText: "No bundle opportunities detected.",
    },
    {
      title: "High Margin Push",
      items: highMarginOpportunities,
      emptyText: "No high-margin push opportunities detected.",
    },
    {
      title: "Substitution Risks",
      items: substitutionRisks,
      emptyText: "No substitution risks detected.",
    },
  ];

  function recordSalesAction(action: string, item: SalesOpportunity) {
    setSalesActivityLog((currentLog) => [
      createActivityEntry(`${action}: ${item.product}`),
      ...currentLog,
    ]);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Sales AI Workspace
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          Revenue & Bundle Intelligence
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A specialist AI workspace for store managers and sales teams. It turns
          inventory pressure into commercial actions such as bundles, upsells,
          substitutions and showroom priorities.
        </p>
      </div>

      <DepartmentAssistantPanel
        moduleName="Sales"
        title="Ask Sales Agent"
        examples={[
          "Which bundles should stores push this week?",
          "What substitutions should sales teams offer for low-stock items?",
          "Which high-margin products deserve showroom priority?",
          "Where can we protect revenue from stockout risk?",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card
          title="Sales Opportunities"
          value={String(salesOpportunities.length)}
          detail="AI-generated actions"
        />
        <Card
          title="Bundle Ideas"
          value={String(bundleOpportunities.length)}
          detail="Move excess stock"
        />
        <Card
          title="High Margin Push"
          value={String(highMarginOpportunities.length)}
          detail="Profit priority"
        />
        <Card
          title="Substitution Risks"
          value={String(substitutionRisks.length)}
          detail="Prevent lost sales"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="AI Sales Opportunities">
          {opportunityGroups.map((group) => (
            <div
              key={group.title}
              className="rounded-2xl border border-white/10 bg-black/30 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-white">
                  {group.title}
                </h3>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300">
                  {group.items.length}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {group.items.length > 0 ? (
                  group.items.slice(0, 5).map((item, index) => (
                    <div
                      key={`${group.title}-${item.product}-${index}`}
                      className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4"
                    >
                      <p className="text-sm font-medium text-amber-200">
                        {item.type}
                      </p>
                      <p className="mt-1 text-sm text-white">{item.product}</p>
                      <p className="mt-2 text-sm text-neutral-300">
                        Reason: {item.reason}
                      </p>
                      <p className="mt-2 text-sm text-neutral-300">
                        Action: {item.action}
                      </p>
                      <p className="mt-2 text-sm text-emerald-200">
                        Impact: {item.expectedImpact}
                      </p>
                      <p className="mt-1 text-sm text-amber-100">
                        {getSalesEstimatedImpact(item, index)}
                      </p>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <ActivityActionButton
                          label="Approve Bundle"
                          onClick={() =>
                            recordSalesAction("Approved sales action", item)
                          }
                        />
                        <ActivityActionButton
                          label="Send to Marketing"
                          onClick={() =>
                            recordSalesAction("Sent to marketing", item)
                          }
                        />
                        <ActivityActionButton
                          label="Push to Stores"
                          onClick={() =>
                            recordSalesAction("Pushed to stores", item)
                          }
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-white/10 bg-black/30 p-4 text-sm text-neutral-400">
                    {group.emptyText}
                  </p>
                )}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Example Agent Workflow">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-medium text-white">
              Sales Activity Log
            </p>
            <div className="mt-3">
              <LocalActivityLog
                entries={salesActivityLog}
                emptyText="No sales workflow actions taken yet."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Inventory Agent detects overstock product
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Sales Agent creates bundle recommendation
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Marketing Agent prepares promotional campaign
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              ✓ Executive Orchestrator receives commercial summary
            </p>
          </div>
        </Panel>
      </section>
    </section>
  );
}

function InventoryModule({
  inventory,
  recommendations,
}: {
  inventory: InventoryItem[];
  recommendations: Recommendation[];
}) {
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [showAllInventory, setShowAllInventory] = useState(false);
  const [inventoryActivityLog, setInventoryActivityLog] = useState<
    WorkflowActivityEntry[]
  >([]);
  const lowStock = inventory.filter((item) => item.status === "low-stock");
  const overstock = inventory.filter((item) => item.status === "overstock");
  const slowMoving = inventory.filter((item) => item.status === "slow-moving");
  const sortedInventory = [...inventory].sort((a, b) => {
    const rankDelta =
      (inventoryStatusRank[a.status] ?? 4) - (inventoryStatusRank[b.status] ?? 4);

    if (rankDelta !== 0) return rankDelta;

    if (a.status === "low-stock" && b.status === "low-stock") {
      return a.stock - b.stock;
    }

    return b.monthlySales - a.monthlySales;
  });
  const filteredInventory =
    inventoryFilter === "all"
      ? sortedInventory
      : sortedInventory.filter((item) => item.status === inventoryFilter);
  const visibleInventory = showAllInventory
    ? filteredInventory
    : filteredInventory.slice(0, 14);

  function recordInventoryAction(action: string, title: string) {
    setInventoryActivityLog((currentLog) => [
      createActivityEntry(`${action}: ${title}`),
      ...currentLog,
    ]);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
          Inventory AI Workspace
        </p>

        <h2 className="mt-4 text-3xl font-semibold">
          Warehouse & Stock Intelligence
        </h2>

        <p className="mt-4 max-w-4xl text-neutral-300">
          A specialist AI workspace for warehouse managers and inventory
          planners. It detects stockout risk, overstock, slow-moving products,
          replenishment priorities and transfer opportunities.
        </p>
      </div>

      <DepartmentAssistantPanel
        moduleName="Inventory"
        title="Ask Inventory Agent"
        examples={[
          "Which products need replenishment first?",
          "Where is warehouse pressure highest?",
          "Which overstock items should we move or discount?",
          "What stock transfers would reduce risk?",
        ]}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Card title="Inventory Records" value={String(inventory.length)} detail="Products monitored" />
        <Card title="Low Stock" value={String(lowStock.length)} detail="Needs replenishment" />
        <Card title="Overstock" value={String(overstock.length)} detail="Promotion opportunity" />
        <Card title="Slow Moving" value={String(slowMoving.length)} detail="Tied inventory" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-xl font-medium">Inventory Risk Table</h3>
              <p className="mt-1 text-sm text-neutral-400">
                Default view prioritises low-stock and high-risk inventory.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {inventoryFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setInventoryFilter(option.value);
                    setShowAllInventory(false);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    inventoryFilter === option.value
                      ? "border-amber-300 bg-amber-300 text-black"
                      : "border-white/10 bg-black/30 text-neutral-300 hover:border-amber-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="pb-3">Product</th>
                  <th className="pb-3">Warehouse</th>
                  <th className="pb-3">Stock</th>
                  <th className="pb-3">Sales</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Margin</th>
                </tr>
              </thead>

              <tbody>
                {visibleInventory.map((item) => (
                  <tr key={item.sku} className="border-t border-white/10">
                    <td className="py-3 pr-4 text-white">{item.name}</td>
                    <td className="py-3 pr-4 text-neutral-300">{item.warehouse}</td>
                    <td className="py-3 pr-4">{item.stock}</td>
                    <td className="py-3 pr-4">{item.monthlySales}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs capitalize ${getInventoryStatusClass(
                          item.status
                        )}`}
                      >
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{item.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredInventory.length > 14 && (
            <button
              type="button"
              onClick={() => setShowAllInventory((current) => !current)}
              className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:border-amber-300 hover:text-white"
            >
              {showAllInventory
                ? "Show fewer records"
                : `Show all ${filteredInventory.length} records`}
            </button>
          )}
        </div>

        <Panel title="Inventory Agent Recommendations">
          {recommendations.slice(0, 6).map((rec, index) => (
            <div
              key={`${rec.title}-${index}`}
              className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4"
            >
              <p className="text-sm font-medium text-amber-200">{rec.type}</p>
              <p className="mt-1 text-sm text-white">{rec.title}</p>
              <p className="mt-2 text-sm text-neutral-300">{rec.action}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <ActivityActionButton
                  label="Request Replenishment"
                  onClick={() =>
                    recordInventoryAction("Requested replenishment", rec.title)
                  }
                />
                <ActivityActionButton
                  label="Create Transfer"
                  onClick={() =>
                    recordInventoryAction("Created transfer", rec.title)
                  }
                />
                <ActivityActionButton
                  label="Send to Sales"
                  onClick={() =>
                    recordInventoryAction("Sent to sales", rec.title)
                  }
                />
              </div>
            </div>
          ))}

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-medium text-white">
              Inventory Activity Log
            </p>
            <div className="mt-3">
              <LocalActivityLog
                entries={inventoryActivityLog}
                emptyText="No inventory workflow actions taken yet."
              />
            </div>
          </div>
        </Panel>
      </section>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-medium">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function Card({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-neutral-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-neutral-300">{detail}</p>
    </div>
  );
}

function SummaryLine({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-neutral-200">
      • {text}
    </div>
  );
}

function MiniChart({
  title,
  values,
  labels,
}: {
  title: string;
  values: number[];
  labels: string[];
}) {
  const max = Math.max(...values);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h3 className="text-lg font-medium">{title}</h3>

      <div className="mt-5 space-y-3">
        {values.map((value, index) => (
          <div key={labels[index]}>
            <div className="mb-1 flex justify-between text-xs text-neutral-400">
              <span>{labels[index]}</span>
              <span>{value}</span>
            </div>
            <div className="h-3 rounded-full bg-black/50">
              <div
                className="h-3 rounded-full bg-amber-300"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
