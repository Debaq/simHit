class TestNumber:
    def __init__(self):
        self.range = list(range(0, 15)) + list(range(13, -15, -1)) + list(range(-13, 1))
        self.index = 0

    def get(self):
        number = self.range[self.index]
        self.index = (self.index + 1) % len(self.range)
        return number



if __name__ == "__main__":
    cycle = TestNumber()
    for _ in range(200):  # Imprime los primeros 50 números del ciclo
        print(cycle.get())