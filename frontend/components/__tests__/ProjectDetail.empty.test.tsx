import { render, screen } from '@testing-library/react';
import { ProjectDetail } from '../ProjectDetail';

const mockProject = {
  id: 'project-1',
  name: 'Test Project',
  description: 'Test Description',
};

describe('ProjectDetail - Empty Credit Batches', () => {
  it('renders empty state when credit_batches array is empty', () => {
    render(
      <ProjectDetail 
        project={mockProject} 
        creditBatches={[]} 
      />
    );
    
    expect(screen.getByText(/no credit batches available/i)).toBeInTheDocument();
    expect(screen.queryByTestId('credit-batch-card')).not.toBeInTheDocument();
  });

  it('shows project info even when batches are empty', () => {
    render(
      <ProjectDetail 
        project={mockProject} 
        creditBatches={[]} 
      />
    );
    
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });
});
