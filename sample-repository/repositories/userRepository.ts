interface User {
  id: number;
  email: string;
}

const users: User[] = [{ id: 1, email: "learner@repotutor.dev" }];

export function findUser(email: string): User | undefined {
  return users.find((user) => user.email === email);
}
