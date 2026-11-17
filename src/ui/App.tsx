import { useState } from 'react';
import { Start } from './Start';
import { Editor } from './Editor';

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  return projectId
    ? <Editor key={projectId} projectId={projectId} onExit={() => setProjectId(null)} />
    : <Start onOpen={setProjectId} />;
}
