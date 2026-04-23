import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { Loader, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import ForceGraph2D from "react-force-graph-2d";

// ── Types matching pipeline-service output ──────────────────────────────────
interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, unknown>;
  x?: number;
  y?: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  properties?: Record<string, unknown>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphPageProps {
  sessionId: string;
  highlightedNodeIds?: string[];
  onGraphLoad?: (nodes: GraphNode[]) => void;
}

// ── Node type → colour mapping ──────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  person: "#e8317a",
  organization: "#8b5cf6",
  topic: "#3b82f6",
  decision: "#22c55e",
  action: "#f59e0b",
  date: "#6366f1",
  location: "#14b8a6",
  concept: "#ec4899",
};

const DEFAULT_COLOR = "#888888";

function getNodeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
}

export function GraphPage({
  sessionId,
  highlightedNodeIds,
  onGraphLoad,
}: GraphPageProps) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graphRef = useRef<{
    zoomToFit: (ms?: number, px?: number) => void;
    zoom: (k: number, ms?: number) => void;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure canvas dimensions from parent container so the graph shrinks
  // when sibling panels (e.g., ChatPanel) appear.
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const highlightedSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds],
  );

  // Fetch graph data from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setGraph(null);
          setLoadedSessionId(sessionId);
          return;
        }
        const data = snapshot.data();
        if (data.graph) {
          setGraph(data.graph as GraphData);
        } else {
          setGraph(null);
        }
        setLoadedSessionId(sessionId);
      },
      (err) => {
        console.error("Graph fetch error:", err);
        setGraph(null);
        setLoadedSessionId(sessionId);
      },
    );
    return () => unsubscribe();
  }, [sessionId]);

  const loading = loadedSessionId !== sessionId;

  // Zoom to fit once graph loads
  useEffect(() => {
    if (graph && graphRef.current) {
      setTimeout(() => graphRef.current?.zoomToFit(400, 60), 300);
    }
    if (graph) {
      onGraphLoad?.(graph.nodes);
    }
  }, [graph, onGraphLoad]);

  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoom(1.5, 300);
  }, []);

  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoom(0.67, 300);
  }, []);

  const handleFit = useCallback(() => {
    graphRef.current?.zoomToFit(400, 60);
  }, []);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode((prev) => (prev?.id === node?.id ? prev : node));
  }, []);

  // Canvas node painter. Highlighted nodes get a static pink outline; no
  // animation so the force-graph doesn't have to repaint.
  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = 6;
      const color = getNodeColor(node.type);
      const isHovered = hoveredNode?.id === node.id;
      const isHighlighted = highlightedSet.has(node.id);

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.strokeStyle = isHighlighted
        ? "#e8317a"
        : isHovered
          ? "#ffffff"
          : color + "88";
      ctx.lineWidth = isHighlighted ? 1.6 : isHovered ? 1.5 : 0.8;
      ctx.stroke();

      if (globalScale > 0.7 || isHighlighted) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isHighlighted ? "#f7d2e4" : "#e0e0e0";
        ctx.fillText(node.label, x, y + radius + 2);
      }
    },
    [hoveredNode, highlightedSet],
  );

  const graphData = useMemo(
    () =>
      graph
        ? {
            nodes: graph.nodes.map((n) => ({ ...n })),
            links: graph.edges.map((e) => ({
              source: e.source,
              target: e.target,
              label: e.label,
              id: e.id,
            })),
          }
        : { nodes: [], links: [] },
    [graph],
  );

  const selectedNode =
    selectedNodeId && graph
      ? (graph.nodes.find((node) => node.id === selectedNodeId) ?? null)
      : null;

  const connectedEdges =
    selectedNode && graph
      ? graph.edges
          .filter(
            (edge) =>
              edge.source === selectedNode.id ||
              edge.target === selectedNode.id,
          )
          .map((edge) => {
            const isSource = edge.source === selectedNode.id;
            const otherNodeId = isSource ? edge.target : edge.source;
            const otherNodeLabel =
              graph.nodes.find((node) => node.id === otherNodeId)?.label ??
              otherNodeId;
            return {
              id: edge.id,
              relation: edge.label,
              otherNodeLabel,
              direction: isSource ? "outgoing" : "incoming",
            };
          })
      : [];

  if (loading) {
    return (
      <div
        ref={containerRef}
        className="flex-1 min-w-0 h-full flex items-center justify-center"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Loader size={24} className="text-[#e8317a] animate-spin" />
          <p className="text-[13px] text-[#888888]">Loading graph...</p>
        </motion.div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 min-w-0 h-full flex items-center justify-center"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <p className="text-[16px] text-[#f0f0f0]">No graph data</p>
          <p className="text-[13px] text-[#888888]">
            This session hasn't been processed yet
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 h-full relative"
    >
      <ForceGraph2D
        ref={graphRef as React.MutableRefObject<never>}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData as never}
        enableNodeDrag={false}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={(
          node: GraphNode,
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => paintNode(node, ctx, globalScale)}
        nodePointerAreaPaint={(
          node: GraphNode,
          color: string,
          ctx: CanvasRenderingContext2D,
        ) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={() => "#2a2a2a"}
        linkWidth={1.2}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.85}
        linkDirectionalArrowColor={() => "#444444"}
        linkCurvature={0.1}
        linkCanvasObjectMode={() => "after"}
        linkCanvasObject={(
          link: { source: GraphNode; target: GraphNode; label?: string },
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => {
          if (!link.label || globalScale < 1.2) return;
          const sx = link.source.x ?? 0;
          const sy = link.source.y ?? 0;
          const tx = link.target.x ?? 0;
          const ty = link.target.y ?? 0;
          const midX = (sx + tx) / 2;
          const midY = (sy + ty) / 2;
          const fontSize = Math.max(8 / globalScale, 2);
          ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#666666";
          ctx.fillText(link.label, midX, midY);
        }}
        onNodeHover={handleNodeHover}
        onNodeClick={(node: GraphNode) => setSelectedNodeId(node.id)}
        onBackgroundClick={() => setSelectedNodeId(null)}
        cooldownTicks={80}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10">
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handleZoomIn}
          className="w-[36px] h-[36px] rounded-lg bg-[#161616] border border-[#2a2a2a] text-[#888888] flex items-center justify-center hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
        >
          <ZoomIn size={16} />
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handleZoomOut}
          className="w-[36px] h-[36px] rounded-lg bg-[#161616] border border-[#2a2a2a] text-[#888888] flex items-center justify-center hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
        >
          <ZoomOut size={16} />
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handleFit}
          className="w-[36px] h-[36px] rounded-lg bg-[#161616] border border-[#2a2a2a] text-[#888888] flex items-center justify-center hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
        >
          <Maximize2 size={16} />
        </motion.button>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-4 bg-[#111111]/90 backdrop-blur-sm border border-[#2a2a2a] rounded-lg px-3 py-2.5 z-10">
        <p className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-2">
          Node Types
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div
                className="w-[8px] h-[8px] rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-[#aaaaaa] capitalize">
                {type}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Hovered node tooltip */}
      {hoveredNode && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 bg-[#111111]/90 backdrop-blur-sm border border-[#2a2a2a] rounded-lg px-3 py-2.5 z-10 max-w-[240px]"
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-[8px] h-[8px] rounded-full flex-shrink-0"
              style={{ backgroundColor: getNodeColor(hoveredNode.type) }}
            />
            <p className="text-[13px] font-medium text-[#f0f0f0] truncate">
              {hoveredNode.label}
            </p>
          </div>
          <p className="text-[11px] text-[#888888] capitalize">
            {hoveredNode.type}
          </p>
        </motion.div>
      )}

      {/* Selected node details */}
      <motion.aside
        initial={false}
        animate={{ x: selectedNode ? 0 : 360, opacity: selectedNode ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="absolute top-0 right-0 h-full w-[320px] bg-[#0f0f0f]/96 backdrop-blur-md border-l border-[#2a2a2a] z-20 p-4"
        style={{ pointerEvents: selectedNode ? "auto" : "none" }}
      >
        {selectedNode && (
          <div className="h-full flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[1.1px] text-[#888888]">
                  Entity Details
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#f0f0f0] leading-tight break-words">
                  {selectedNode.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="px-2 py-1 text-[11px] rounded-md border border-[#333333] text-[#aaaaaa] hover:text-[#f0f0f0] hover:border-[#e8317a] transition-colors"
              >
                Close
              </button>
            </div>

            <div className="mt-3 inline-flex items-center gap-2 self-start rounded-full border border-[#2a2a2a] px-2.5 py-1">
              <div
                className="w-[8px] h-[8px] rounded-full"
                style={{ backgroundColor: getNodeColor(selectedNode.type) }}
              />
              <span className="text-[11px] text-[#bbbbbb] capitalize">
                {selectedNode.type}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <p className="text-[12px] text-[#9a9a9a] uppercase tracking-[1px]">
                Connected Relations
              </p>
              <span className="text-[11px] text-[#666666]">
                {connectedEdges.length}
              </span>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto pr-1 space-y-2">
              {connectedEdges.length === 0 && (
                <div className="rounded-lg border border-[#222222] bg-[#141414] px-3 py-2.5">
                  <p className="text-[12px] text-[#888888]">
                    No connected edges for this node.
                  </p>
                </div>
              )}

              {connectedEdges.map((edge) => (
                <div
                  key={edge.id}
                  className="rounded-lg border border-[#232323] bg-[#151515] px-3 py-2.5"
                >
                  <p className="text-[11px] text-[#787878] uppercase tracking-[0.8px]">
                    {edge.direction}
                  </p>
                  <p className="text-[13px] text-[#f0f0f0] mt-0.5 break-words">
                    {edge.relation || "related_to"}
                  </p>
                  <p className="text-[12px] text-[#aaaaaa] mt-1 break-words">
                    {edge.otherNodeLabel}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.aside>

      {/* Stats bar */}
      <div className="absolute bottom-4 left-4 flex items-center gap-3 z-10">
        <span className="text-[11px] text-[#666666]">
          {graph.nodes.length} nodes
        </span>
        <span className="text-[11px] text-[#444444]">/</span>
        <span className="text-[11px] text-[#666666]">
          {graph.edges.length} edges
        </span>
      </div>
    </div>
  );
}
