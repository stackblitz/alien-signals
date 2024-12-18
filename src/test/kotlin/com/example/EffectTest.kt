package com.example

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class EffectTest {

    @Test
    fun testClearSubscriptionsWhenUntrackedByAllSubscribers() {
        var bRunTimes = 0

        val a = Signal(1)
        val b = Computed {
            bRunTimes++
            a.get() * 2
        }
        val effect1 = Effect {
            b.get()
        }

        assertEquals(1, bRunTimes)
        a.set(2)
        assertEquals(2, bRunTimes)
        effect1.stop()
        a.set(3)
        assertEquals(2, bRunTimes)
    }

    @Test
    fun testNotRunUntrackedInnerEffect() {
        val a = Signal(3)
        val b = Computed { a.get() > 0 }

        Effect {
            if (b.get()) {
                Effect {
                    if (a.get() == 0) {
                        throw Error("bad")
                    }
                }
            }
        }

        decrement(a)
        decrement(a)
        decrement(a)
    }

    @Test
    fun testRunOuterEffectFirst() {
        val a = Signal(1)
        val b = Signal(1)

        Effect {
            if (a.get()) {
                Effect {
                    b.get()
                    if (a.get() == 0) {
                        throw Error("bad")
                    }
                }
            } else {
            }
        }

        startBatch()
        b.set(0)
        a.set(0)
        endBatch()
    }

    @Test
    fun testNotTriggerInnerEffectWhenResolveMaybeDirty() {
        val a = Signal(0)
        val b = Computed { a.get() % 2 }

        var innerTriggerTimes = 0

        Effect {
            Effect {
                b.get()
                innerTriggerTimes++
                if (innerTriggerTimes > 1) {
                    throw Error("bad")
                }
            }
        }

        a.set(2)
    }

    @Test
    fun testTriggerInnerEffectsInSequence() {
        val a = Signal(0)
        val b = Signal(0)
        val c = Computed { a.get() - b.get() }
        val order = mutableListOf<String>()

        Effect {
            c.get()

            Effect {
                order.add("first inner")
                a.get()
            }

            Effect {
                order.add("last inner")
                a.get()
                b.get()
            }
        }

        order.clear()

        startBatch()
        b.set(1)
        a.set(1)
        endBatch()

        assertEquals(listOf("first inner", "last inner"), order)
    }

    @Test
    fun testTriggerInnerEffectsInSequenceInEffectScope() {
        val a = Signal(0)
        val b = Signal(0)
        val scope = EffectScope()
        val order = mutableListOf<String>()

        scope.run {
            Effect {
                order.add("first inner")
                a.get()
            }

            Effect {
                order.add("last inner")
                a.get()
                b.get()
            }
        }

        order.clear()

        startBatch()
        b.set(1)
        a.set(1)
        endBatch()

        assertEquals(listOf("first inner", "last inner"), order)
    }

    private fun decrement(a: Signal<Int>) {
        a.set(a.get() - 1)
    }
}
