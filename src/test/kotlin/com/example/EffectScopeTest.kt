package com.example

import kotlin.test.Test
import kotlin.test.assertEquals

class EffectScopeTest {

    @Test
    fun testEffectScopeStop() {
        val count = Signal(1)
        val scope = EffectScope()

        var triggers = 0

        scope.run {
            Effect {
                triggers++
                count.get()
            }
        }

        assertEquals(1, triggers)
        count.set(2)
        assertEquals(2, triggers)
        scope.stop()
        count.set(3)
        assertEquals(2, triggers)
    }
}
