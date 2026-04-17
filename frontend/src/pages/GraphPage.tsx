import { useState, useEffect, useRef, useCallback } from "react";
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

// Sidebar width constant (matches DashboardPage)
const SIDEBAR_WIDTH = 220;

export function GraphPage({ sessionId }: GraphPageProps) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<{
    zoomToFit: (ms?: number, px?: number) => void;
    zoom: (k: number, ms?: number) => void;
  } | null>(null);

  // Compute canvas dimensions from window size
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth - SIDEBAR_WIDTH,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () => {
      setDimensions({
        width: window.innerWidth - SIDEBAR_WIDTH,
        height: window.innerHeight,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Fetch graph data from Firestore
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.graph) {
          setGraph(data.graph as GraphData);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Graph fetch error:", err);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [sessionId]);

  // Zoom to fit once graph loads
  useEffect(() => {
    if (graph && graphRef.current) {
      setTimeout(() => graphRef.current?.zoomToFit(400, 60), 300);
    }
  }, [graph]);

  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoom(1.5, 300);
  }, []);

  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoom(0.67, 300);
  }, []);

  const handleFit = useCallback(() => {
    graphRef.current?.zoomToFit(400, 60);
  }, []);

  // Canvas node painter
  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = 6;
      const color = getNodeColor(node.type);
      const isHovered = hoveredNode?.id === node.id;

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

      ctx.strokeStyle = isHovered ? "#ffffff" : color + "88";
      ctx.lineWidth = isHovered ? 1.5 : 0.8;
      ctx.stroke();

      if (globalScale > 0.7) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#e0e0e0";
        ctx.fillText(node.label, x, y + radius + 2);
      }
    },
    [hoveredNode],
  );

  const graphData = graph
    ? {
        nodes: graph.nodes.map((n) => ({ ...n })),
        links: graph.edges.map((e) => ({
          source: e.source,
          target: e.target,
          label: e.label,
          id: e.id,
        })),
      }
    : { nodes: [], links: [] };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
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
      <div className="flex-1 flex items-center justify-center">
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
    <div style={{ position: "relative", width: dimensions.width, height: dimensions.height }}>
      <ForceGraph2D
        ref={graphRef as React.MutableRefObject<never>}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData as never}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) =>
          paintNode(node, ctx, globalScale)
        }
        nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
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
        linkCanvasObject={(link: { source: GraphNode; target: GraphNode; label?: string }, ctx: CanvasRenderingContext2D, globalScale: number) => {
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
        onNodeHover={(node: GraphNode | null) => setHoveredNode(node)}
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
