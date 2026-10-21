import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../utils/logger';
import MapFallbackTable from './MapFallbackTable';

interface ProjectMapProps {
  projects: any[];
  [key: string]: any;
}

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class MapErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('ProjectMap render error', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const ProjectMap: React.FC<ProjectMapProps> = ({ projects, ...rest }) => {
  return (
    <MapErrorBoundary fallback={<MapFallbackTable projects={projects} />}>
      <ProjectMapInner projects={projects} {...rest} />
    </MapErrorBoundary>
  );
};

const ProjectMapInner: React.FC<ProjectMapProps> = ({ projects, ...rest }) => {
  return (
    <div className="project-map" {...rest}>
      {projects.map((project) => (
        <div key={project.id} className="project-map__marker">
          {project.name}
        </div>
      ))}
    </div>
  );
};

export default ProjectMap;
