export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: any;
}

export interface Member {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  isMe: boolean;
  order: number;
}

export interface Brand {
  id: string;
  ownerId: string;
  memberId: string;
  name: string;
  order: number;
}

export interface Project {
  id: string;
  ownerId: string;
  brandId: string;
  memberId: string;
  name: string;
  status: 'active' | 'archived';
  summary: string;
  startDate: string;
  endDate: string;
  createdAt: any;
  updatedAt: any;
}

export interface Task {
  id: string;
  projectId: string;
  ownerId: string;
  text: string;
  startDate: string;
  dueDate: string;
  progress: 'not-started' | 'in-progress' | 'completed';
  order: number;
  createdAt: any;
}

export interface Note {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  body: string;
  date: string;
  order: number;
  createdAt: any;
}

export interface Meeting {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  date: string;
  createdAt: any;
}

export interface Travel {
  id: string;
  projectId: string;
  ownerId: string;
  type: 'Flight' | 'Hotel' | 'Factory Contact';
  title: string;
  startDate: string;
  endDate: string;
  link: string;
  createdAt: any;
}

export interface Link {
  id: string;
  projectId: string;
  ownerId: string;
  label: string;
  url: string;
  createdAt: any;
}
