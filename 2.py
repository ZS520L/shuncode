import random


def roll_dice(n=2, sides=6):
    return [random.randint(1, sides) for _ in range(n)]


def is_palindrome(s):
    cleaned = s.lower().replace(" ", "")
    return cleaned == cleaned[::-1]


if __name__ == "__main__":
    print("Dice roll:", roll_dice())
    print("'racecar' is palindrome:", is_palindrome("racecar"))
    print("'hello' is palindrome:", is_palindrome("hello"))
