import { formatCredits } from "../lib/formatCredits";

interface CreditCardProps {
  credits: number;
  locale?: string;
}

export default function CreditCard({ credits, locale = "en" }: CreditCardProps) {
  return (
    <div className="credit-card">
      <span className="credit-card__label">Credits</span>
      <span className="credit-card__value">{formatCredits(credits, locale)}</span>
    </div>
  );
}
