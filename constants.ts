import { Transaction, Budget, Bill, Category } from './types';

export const INITIAL_TRANSACTIONS: Transaction[] = [
  { id: '1', date: '2023-10-24', description: 'Compras de Mercado', category: 'Alimentação', amount: 142.50, type: 'expense' },
  { id: '2', date: '2023-10-23', description: 'Salário Mensal', category: 'Salário', amount: 4200.00, type: 'income' },
  { id: '3', date: '2023-10-22', description: 'Assinatura Netflix', category: 'Entretenimento', amount: 15.99, type: 'expense' },
  { id: '4', date: '2023-10-20', description: 'Posto de Gasolina', category: 'Transporte', amount: 55.00, type: 'expense' },
  { id: '5', date: '2023-10-19', description: 'Café Starbucks', category: 'Alimentação', amount: 6.45, type: 'expense' },
];

export const INITIAL_BUDGETS: Budget[] = [
  { category: 'Alimentação', limit: 600, spent: 450 },
  { category: 'Transporte', limit: 300, spent: 120 },
  { category: 'Moradia' as any, limit: 1500, spent: 1500 },
  { category: 'Entretenimento', limit: 250, spent: 280 },
  { category: 'Compras', limit: 400, spent: 0 },
];

export const INITIAL_BILLS: Bill[] = [
  { id: '1', name: 'Assinatura Cloud Storage', dueDate: '2023-10-24', amount: 12.99, status: 'pending', category: 'Utilidades' },
  { id: '2', name: 'Conta de Luz', dueDate: '2023-10-27', amount: 142.50, status: 'pending', category: 'Utilidades' },
  { id: '3', name: 'Aluguel Mensal', dueDate: '2023-11-01', amount: 1800.00, status: 'scheduled', category: 'Moradia' },
];

export const CATEGORIES: Category[] = [
  'Alimentação',
  'Salário',
  'Investimentos',
  'Freelance',
  'Presentes',
  'Entretenimento',
  'Transporte',
  'Compras',
  'Moradia',
  'Utilidades',
  'Outros'
];
