export type Category = string;

export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: Category;
  amount: number;
  type: 'income' | 'expense';
}

export interface Budget {
  category: Category;
  limit: number;
  spent: number;
  description?: string;
}

export interface Bill {
  id: string;
  name: string;
  dueDate: string;
  amount: number;
  status: 'pending' | 'scheduled' | 'paid';
  category: string;
  installments?: number;
  recurring?: boolean;
}
