def hello(name="World"):
    print(f"Hello, {name}!")


def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b


if __name__ == "__main__":
    hello("Python")
    print(list(fibonacci(10)))
