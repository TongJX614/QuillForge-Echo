# -*- coding: utf-8 -*-
"""TTS 角色音色分配测试。

重点保证同一剧本里同性别的角色不会因为年龄档相同而拿到同一个音色。
"""

from tts_gen import TTSGenerator


MALE_POOL = ["m0", "m1", "m2", "m3"]
FEMALE_POOL = ["f0", "f1", "f2", "f3"]


def make_generator() -> TTSGenerator:
    gen = TTSGenerator.__new__(TTSGenerator)
    gen.voice_map = {}
    gen.voice_male_by_age = list(MALE_POOL)
    gen.voice_female_by_age = list(FEMALE_POOL)
    gen.default_voice = "default"
    gen.default_voice_male = "male_default"
    gen.default_voice_female = "female_default"
    gen.age_thresholds = [18, 35, 55]
    return gen


def character(name: str, gender: str = "male", age: str = "30", **extra) -> dict:
    return {"id": name, "name": name, "gender": gender, "age": age, **extra}


def test_same_gender_same_age_gets_distinct_voices():
    gen = make_generator()
    chars = [character("甲"), character("乙")]

    voices = [gen.get_voice_id(c["name"], chars) for c in chars]

    assert len(set(voices)) == 2
    assert set(voices) <= set(MALE_POOL)


def test_four_male_characters_use_four_distinct_voices():
    gen = make_generator()
    chars = [character(name, age="60") for name in ("甲", "乙", "丙", "丁")]

    voices = [gen.get_voice_id(c["name"], chars) for c in chars]

    assert len(set(voices)) == 4
    assert set(voices) == set(MALE_POOL)


def test_male_and_female_use_separate_pools():
    gen = make_generator()
    chars = [
        character("男一", gender="male", age="30"),
        character("女一", gender="female", age="30"),
    ]

    male_voice = gen.get_voice_id("男一", chars)
    female_voice = gen.get_voice_id("女一", chars)

    assert male_voice in MALE_POOL
    assert female_voice in FEMALE_POOL


def test_explicit_voice_id_wins():
    gen = make_generator()
    chars = [
        character("甲", voiceId="custom-male"),
        character("乙"),
    ]

    assert gen.get_voice_id("甲", chars) == "custom-male"
    assert gen.get_voice_id("乙", chars) in MALE_POOL


def test_voice_map_wins():
    gen = make_generator()
    gen.voice_map = {"甲": "mapped-male"}
    chars = [character("甲")]

    assert gen.get_voice_id("甲", chars) == "mapped-male"


def test_personality_orders_voice_age_region():
    gen = make_generator()
    chars = [
        character("活泼者", personality="活泼、跳脱、爱玩笑"),
        character("沉稳者", personality="沉稳、冰冷、威严"),
    ]

    playful = gen.get_voice_id("活泼者", chars)
    calm = gen.get_voice_id("沉稳者", chars)

    assert playful != calm
    assert MALE_POOL.index(playful) < MALE_POOL.index(calm)