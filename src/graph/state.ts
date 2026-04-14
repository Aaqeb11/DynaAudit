import { StateSchema, ReducedValue, MessagesValue } from "@langchain/langgraph";
import { z } from "zod";

export const SeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const ExploitChunkSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  vulnerabilityType: z.string(),
  affectedPattern: z.string(),
  severity: SeveritySchema,
  source: z.string(),
  date: z.string(),
});

export const StaticFindingSchema = z.object({
  tool: z.enum(["slither", "mythril", "mock"]),
  issueType: z.string(),
  description: z.string(),
  affectedLines: z.array(z.number()).optional(),
  severity: SeveritySchema,
});

export const VulnerabilityFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  affectedLines: z.array(z.number()).optional(),
  isNovel: z.boolean(),
  matchedExploit: z.string().optional(),
});

export const AuditReportSchema = z.object({
  contractName: z.string(),
  auditedAt: z.string(),
  totalFindings: z.number(),
  findings: z.array(VulnerabilityFindingSchema),
  summary: z.string(),
  riskScore: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "SAFE"]),
});

export type ExploitChunk = z.infer<typeof ExploitChunkSchema>;
export type StaticFinding = z.infer<typeof StaticFindingSchema>;
export type VulnerabilityFinding = z.infer<typeof VulnerabilityFindingSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const AuditStateSchema = new StateSchema({
  // Input
  contractCode: z.string().default(""),
  contractPath: z.string().default(""),

  // Phase 1
  contractSummary: z.string().default(""),

  // RAG context
  ragContext: new ReducedValue(
    z.array(ExploitChunkSchema).default(() => []),
    {
      inputSchema: z.array(ExploitChunkSchema),
      reducer: (_, next) => next,
    },
  ),

  staticFindings: new ReducedValue(
    z.array(StaticFindingSchema).default(() => []),
    {
      inputSchema: z.array(StaticFindingSchema),
      reducer: (_, next) => next,
    },
  ),

  // Phase 2 — vulnerabilities from SCA + SPE
  vulnerabilities: new ReducedValue(
    z.array(VulnerabilityFindingSchema).default(() => []),
    {
      inputSchema: z.array(VulnerabilityFindingSchema),
      reducer: (_, next) => next,
    },
  ),

  // Phase 3 — final report from SCC
  finalReport: z.union([AuditReportSchema, z.null()]).default(null),

  // Full conversation history — appends across all phases
  messages: MessagesValue,

  // Phase tracker
  currentPhase: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

export type AuditStateType = typeof AuditStateSchema.State;
