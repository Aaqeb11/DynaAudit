import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AuditStateSchema } from "./state";
import {
  readContractNode,
  ragRetrieverNode,
  staticAnalyzerNode,
  phase1Node,
  phase2Node,
  phase3Node,
} from "./nodes";

// ─── Build Graph

export function buildAuditPipeline() {
  const checkpointer = new MemorySaver();

  const graph = new StateGraph(AuditStateSchema)
    // ── Nodes ──
    .addNode("readContract", readContractNode)
    .addNode("ragRetriever", ragRetrieverNode)
    .addNode("staticAnalyzer", staticAnalyzerNode)
    .addNode("phase1", phase1Node)
    .addNode("phase2", phase2Node)
    .addNode("phase3", phase3Node)

    // ── Edges ──
    .addEdge(START, "readContract")

    // RAG and static run in parallel after contract is loaded
    .addEdge("readContract", "ragRetriever")
    .addEdge("readContract", "staticAnalyzer")

    // Phase 1 starts only after both parallel nodes complete
    .addEdge("ragRetriever", "phase1")
    .addEdge("staticAnalyzer", "phase1")

    // Sequential phase execution
    .addEdge("phase1", "phase2")
    .addEdge("phase2", "phase3")
    .addEdge("phase3", END);

  return graph.compile({ checkpointer });
}

export type AuditPipeline = ReturnType<typeof buildAuditPipeline>;
