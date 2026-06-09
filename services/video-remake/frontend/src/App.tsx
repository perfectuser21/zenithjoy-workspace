import React, { useCallback } from 'react';
import ReactFlow, { Node, Edge, addEdge, Connection, useNodesState, useEdgesState, MiniMap, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

const initialNodes: Node[] = [
  { id: '01', position: { x: 0,   y: 0   }, data: { label: '01 输入素材' } },
  { id: '02', position: { x: 220, y: 0   }, data: { label: '02 拆视频' } },
  { id: '03', position: { x: 440, y: 0   }, data: { label: '03 关键帧筛选' } },
  { id: '04', position: { x: 660, y: 0   }, data: { label: '04 出图模型' } },
  { id: '05', position: { x: 880, y: 0   }, data: { label: '05 锁模特' } },
  { id: '06', position: { x: 0,   y: 180 }, data: { label: '06 锁产品' } },
  { id: '07', position: { x: 220, y: 180 }, data: { label: '07 开始图通过' } },
  { id: '08', position: { x: 440, y: 180 }, data: { label: '08 HappyHorse i2v' } },
  { id: '09', position: { x: 660, y: 180 }, data: { label: '09 视频输出' } },
];

const initialEdges: Edge[] = [
  { id: 'e01-02', source: '01', target: '02' },
  { id: 'e02-03', source: '02', target: '03' },
  { id: 'e03-04', source: '03', target: '04' },
  { id: 'e04-05', source: '04', target: '05' },
  { id: 'e05-06', source: '05', target: '06' },
  { id: 'e06-07', source: '06', target: '07' },
  { id: 'e07-08', source: '07', target: '08' },
  { id: 'e08-09', source: '08', target: '09' },
];

export default function App() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
