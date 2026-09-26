import type { Meta, StoryObj } from '@storybook/react';
import {
  ArgTypes,
  Description,
  Stories,
  Subtitle,
  Title,
} from '@storybook/blocks';
import type { ComponentType } from 'react';
import AuditExplorer from '../AuditExplorer';
import BulkPurchaseCart from '../BulkPurchaseCart';
import BulkPurchaseWizard from '../BulkPurchaseWizard';
import ComparisonTray from '../ComparisonTray';
import CreditCard from '../CreditCard';
import { EmptyState } from '../EmptyState';
import ErrorBoundary from '../ErrorBoundary';
import { EsgBarChart } from '../EsgBarChart';
import { EsgDateRangeFilter } from '../EsgDateRangeFilter';
import { EsgKpiCards } from '../EsgKpiCards';
import { EsgPieChart } from '../EsgPieChart';
import Highlight from '../Highlight';
import LazyImage from '../LazyImage';
import LoadingSkeleton from '../LoadingSkeleton';
import { Marketplace } from '../Marketplace';
import MarketplaceFilter from '../MarketplaceFilter';
import Navbar from '../Navbar';
import NetworkStatusIndicator from '../NetworkStatusIndicator';
import { ProjectDetail } from '../ProjectDetail';
import { ProvenanceTrail } from '../ProvenanceTrail';
import RetirementCertificate from '../RetirementCertificate';
import SerialRangeBar from '../SerialRangeBar';
import ThemeToggle from '../ThemeToggle';
import Toast from '../Toast';
import Tooltip from '../Tooltip';
import TransactionHistory from '../TransactionHistory';
import TransactionStatus from '../TransactionStatus';
import WalletPrompt from '../WalletPrompt';

const documentedComponents: Array<{ name: string; component: ComponentType<any> }> = [
  { name: 'AuditExplorer', component: AuditExplorer },
  { name: 'BulkPurchaseCart', component: BulkPurchaseCart },
  { name: 'BulkPurchaseWizard', component: BulkPurchaseWizard },
  { name: 'ComparisonTray', component: ComparisonTray },
  { name: 'CreditCard (marketplace listing card)', component: CreditCard },
  { name: 'EmptyState', component: EmptyState },
  { name: 'ErrorBoundary', component: ErrorBoundary },
  { name: 'EsgBarChart', component: EsgBarChart },
  { name: 'EsgDateRangeFilter', component: EsgDateRangeFilter },
  { name: 'EsgKpiCards', component: EsgKpiCards },
  { name: 'EsgPieChart', component: EsgPieChart },
  { name: 'Highlight', component: Highlight },
  { name: 'LazyImage', component: LazyImage },
  { name: 'LoadingSkeleton', component: LoadingSkeleton },
  { name: 'Marketplace', component: Marketplace },
  { name: 'MarketplaceFilter', component: MarketplaceFilter },
  { name: 'Navbar', component: Navbar },
  { name: 'NetworkStatusIndicator', component: NetworkStatusIndicator },
  { name: 'ProjectDetail', component: ProjectDetail },
  { name: 'ProvenanceTrail', component: ProvenanceTrail },
  { name: 'RetirementCertificate', component: RetirementCertificate },
  { name: 'SerialRangeBar', component: SerialRangeBar },
  { name: 'ThemeToggle', component: ThemeToggle },
  { name: 'Toast', component: Toast },
  { name: 'Tooltip', component: Tooltip },
  { name: 'TransactionHistory', component: TransactionHistory },
  { name: 'TransactionStatus', component: TransactionStatus },
  { name: 'WalletPrompt', component: WalletPrompt },
];

const palette = [
  ['Primary', '50-950', 'var(--color-primary-50) through var(--color-primary-950)'],
  ['Neutral', '50-950', 'var(--color-neutral-50) through var(--color-neutral-950)'],
  ['Verified', 'semantic', 'background, text, and border tokens'],
  ['Pending', 'semantic', 'background, text, and border tokens'],
  ['Suspended', 'semantic', 'background, text, and border tokens'],
  ['Rejected', 'semantic', 'background, text, and border tokens'],
  ['Completed', 'semantic', 'background, text, and border tokens'],
  ['USDC', 'brand', 'var(--color-usdc)'],
];

function DocumentationPage() {
  return (
    <>
      <Title />
      <Subtitle>CarbonLedger frontend component reference</Subtitle>
      <Description>
        Every component below has a typed props table. Existing stories are the live examples;
        use the Storybook theme toolbar to inspect light, dark, and system variants.
      </Description>

      <h2>Design system palette</h2>
      <table>
        <thead><tr><th>Token group</th><th>Scale</th><th>Usage</th></tr></thead>
        <tbody>
          {palette.map(([group, scale, usage]) => (
            <tr key={group}><td>{group}</td><td>{scale}</td><td>{usage}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        Surfaces and semantic colors resolve through CSS variables, so the same component follows
        the active theme. Dark mode is available from the global Theme toolbar and should be checked
        for contrast, focus visibility, and status meaning.
      </p>

      <h2>Live examples</h2>
      <p>These are the existing interactive stories for the documented components.</p>
      <Stories />

      <h2>Accessibility baseline</h2>
      <ul>
        <li>Keep the provided semantic landmarks, headings, labels, and button names intact.</li>
        <li>All actions must remain keyboard reachable with a visible focus indicator.</li>
        <li>Do not communicate status with color alone; preserve the visible status text.</li>
        <li>Use meaningful alt text for images and verify dynamic updates with a screen reader.</li>
        <li>Run the Storybook Accessibility panel for every meaningful state, including dark mode.</li>
      </ul>

      {documentedComponents.map(({ name, component }) => (
        <section key={name}>
          <h2>{name}</h2>
          <ArgTypes of={component} />
        </section>
      ))}
    </>
  );
}

const meta: Meta = {
  title: 'Foundation/Component Documentation',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: { page: DocumentationPage },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Reference: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Reference for 28 production components, their props, live stories, themes, and accessibility requirements.',
      },
    },
  },
};
