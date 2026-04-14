import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { AuditStateType } from "./state";
import { VulnerabilityFindingSchema, AuditReportSchema } from "./state";
import {
  PM_SYSTEM_PROMPT,
  SCA_SYSTEM_PROMPT,
  SPE_SYSTEM_PROMPT,
  SCC_SYSTEM_PROMPT,
  buildPmInitMessage,
  buildScaPhase1Message,
  buildSpePhase2Message,
  buildSccPhase3Message,
} from "../agents/prompts";
import { readFile } from "fs/promises";
import path from "path";

// ─── LLM Instance
const llm = new ChatOpenAI({
  model: "google/gemini-2.5-flash",
  temperature: 0.2,
  apiKey: process.env.OPENROUTER_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "X-Title": "DynaAudit",
    },
  },
});

// Read Contract
export async function readContractNode(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log(`📄 [Read] Loading contract from ${state.contractPath}...`);

  const absolutePath = path.resolve(state.contractPath);
  const contractCode = await readFile(absolutePath, "utf-8");

  if (!absolutePath.endsWith(".sol")) {
    throw new Error(
      `Invalid file type — expected a .sol file, got: ${absolutePath}`,
    );
  }

  if (contractCode.trim().length === 0) {
    throw new Error(`Contract file is empty: ${absolutePath}`);
  }

  console.log(`✅ [Read] Loaded ${contractCode.length} characters`);

  return {
    contractCode,
  };
}

export async function ragRetrieverNode(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log("🔍 [RAG] Retrieving exploit context...");

  // Mock: hardcoded exploits — replace with real pgvector query later
  const mockExploits = [
    {
      id: "exploit-001",
      title: "The DAO Reentrancy Attack",
      description:
        "Attacker repeatedly called withdraw() before balance was updated, draining the contract.",
      vulnerabilityType: "Reentrancy",
      affectedPattern: "external call before state update",
      severity: "CRITICAL" as const,
      source: "Rekt.news",
      date: "2016-06-17",
    },
    {
      id: "exploit-002",
      title: "Euler Finance Flash Loan Attack",
      description:
        "Attacker used flash loans to manipulate internal accounting, exploiting donation logic.",
      vulnerabilityType: "Flash Loan / Accounting Manipulation",
      affectedPattern: "unchecked donation with leverage",
      severity: "CRITICAL" as const,
      source: "Rekt.news",
      date: "2023-03-13",
    },
  ];

  return {
    ragContext: mockExploits,
  };
}

// ─── Mock Static Analyzer

export async function staticAnalyzerNode(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log("🛠️  [Static] Running static analysis...");

  // Mock: hardcoded findings — replace with real Slither/Mythril subprocess later
  const mockFindings = [
    {
      tool: "mock" as const,
      issueType: "Reentrancy",
      description:
        "Potential reentrancy detected — external call precedes state variable update.",
      affectedLines: [42, 43],
      severity: "HIGH" as const,
    },
    {
      tool: "mock" as const,
      issueType: "Missing Zero Address Check",
      description:
        "Constructor does not validate that owner address is non-zero.",
      affectedLines: [12],
      severity: "MEDIUM" as const,
    },
  ];

  return {
    staticFindings: mockFindings,
  };
}

// ─── Phase 1: PM → SCA

export async function phase1Node(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log("📌 [Phase 1] PM initiating audit → SCA analysing contract...");

  // PM sends the opening message
  const pmMessage = new HumanMessage(buildPmInitMessage(state));

  // SCA responds with contract analysis
  const scaResponse = await llm.invoke([
    new SystemMessage(`${PM_SYSTEM_PROMPT}\n\n${SCA_SYSTEM_PROMPT}`),
    pmMessage,
  ]);

  console.log("✅ [Phase 1] SCA analysis complete");

  return {
    contractSummary: scaResponse.content as string,
    currentPhase: 2,
    messages: [pmMessage, scaResponse],
  };
}

// ─── Phase 2: SCA → SPE (role reversal)

export async function phase2Node(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log("🔍 [Phase 2] SCA challenging SPE — role reversal...");

  // SCA becomes the user, drives the vulnerability conversation
  const scaAsUserMessage = new HumanMessage(buildSpePhase2Message(state));

  // SPE responds as assistant, challenging and expanding on SCA's findings
  const speResponse = await llm.invoke([
    new SystemMessage(`${SCA_SYSTEM_PROMPT}\n\n${SPE_SYSTEM_PROMPT}`),
    ...state.messages.filter((m) => m._getType() !== "system"),
    scaAsUserMessage,
  ]);

  // Parse SPE's response into structured vulnerability findings
  // SPE is prompted to return JSON — parse and validate with Zod
  let vulnerabilities = [];
  try {
    const jsonMatch = (speResponse.content as string).match(
      /```json\n([\s\S]*?)\n```/,
    );
    const jsonString = jsonMatch?.[1] ?? (speResponse.content as string);
    const raw = JSON.parse(jsonString);
    vulnerabilities = Array.isArray(raw)
      ? raw.map((v) => VulnerabilityFindingSchema.parse(v))
      : [];
  } catch (err) {
    console.warn(
      "⚠️  [Phase 2] Could not parse structured vulnerabilities — storing raw response",
    );
    // Fallback: store raw as a single unstructured finding
    vulnerabilities = [
      {
        id: "raw-001",
        title: "Unstructured Findings",
        description: speResponse.content as string,
        severity: "HIGH" as const,
        confidence: 0.5,
        isNovel: false,
      },
    ];
  }

  console.log(
    `✅ [Phase 2] ${vulnerabilities.length} vulnerabilities identified`,
  );

  return {
    vulnerabilities,
    currentPhase: 3,
    messages: [scaAsUserMessage, speResponse],
  };
}

// ─── Phase 3: SCC Report Generation

export async function phase3Node(
  state: AuditStateType,
): Promise<Partial<AuditStateType>> {
  console.log("⚖️  [Phase 3] SCC validating findings and generating report...");

  const sccMessage = new HumanMessage(buildSccPhase3Message(state));

  const sccResponse = await llm.invoke([
    new SystemMessage(SCC_SYSTEM_PROMPT),
    ...state.messages.filter((m) => m._getType() !== "system"),
    sccMessage,
  ]);

  // Parse final report JSON from SCC response
  let finalReport = null;
  try {
    const jsonMatch = (sccResponse.content as string).match(
      /```json\n([\s\S]*?)\n```/,
    );
    const jsonString = jsonMatch?.[1] ?? (sccResponse.content as string);
    const raw = JSON.parse(jsonString);
    finalReport = AuditReportSchema.parse(raw);
  } catch (err) {
    console.error("❌ [Phase 3] Failed to parse final report:", err);
  }

  console.log("✅ [Phase 3] Audit complete");

  return {
    finalReport,
    messages: [sccMessage, sccResponse],
  };
}
